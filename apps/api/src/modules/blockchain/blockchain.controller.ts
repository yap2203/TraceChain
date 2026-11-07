import { CompanyRole } from '@tracechain/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { id } from 'ethers';

import type { AuthService } from '../auth/auth.service.js';
import type { BlockchainGateway } from './blockchain-gateway.service.js';
import type { ApplicationMetadataRepository } from './application-metadata.repository.js';
import type { CompanyRoleIssuanceRepository } from '../ssi/issuance.repository.js';
import {
  applicationTransactionSchema,
  credentialLifecycleTransactionSchema,
  rejectionTransactionSchema,
  rolePermissionTransactionSchema,
  stakeholderLifecycleTransactionSchema,
} from './blockchain.schema.js';

export class BlockchainController {
  constructor(
    private readonly gateway: BlockchainGateway,
    private readonly authService: AuthService,
    private readonly sessionCookieName: string,
    private readonly applicationMetadata: ApplicationMetadataRepository,
    private readonly issuanceRepository: CompanyRoleIssuanceRepository,
  ) {}

  listApplications = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.requireAdministrator(request);
      const applications = await this.gateway.listApplications();
      response.json({
        applications: await Promise.all(
          applications.map(async (application) => ({
            ...application,
            ...(await this.applicationMetadata.find(application.id)),
          })),
        ),
      });
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  listCredentials = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.requireAdministrator(request);
      const records = await this.issuanceRepository.list();
      const credentialResults = await Promise.all(
        records.map(async (issuance) => {
          let chain;
          try {
            chain = await this.gateway.getCredential(issuance.credentialId);
          } catch {
            return null;
          }
          const stakeholder = await this.gateway.getStakeholder(chain.subject);
          const expired = chain.expiresAt * 1_000 <= Date.now();
          const status =
            expired && chain.status === 1
              ? 'expired'
              : (({ 1: 'active', 2: 'suspended', 3: 'revoked' } as const)[chain.status] ??
                'unknown');
          return {
            applicationId: issuance.applicationId,
            companyName: issuance.companyName,
            companyRegistrationNumber: issuance.companyRegistrationNumber,
            credentialHash: chain.credentialHash,
            credentialId: issuance.credentialId,
            encryptedCredentialCid: chain.encryptedCid,
            expiresAt: chain.expiresAt,
            issuedAt: chain.issuedAt,
            issuer: chain.issuer,
            role: issuance.role,
            status,
            stakeholderStatus:
              ({ 1: 'active', 2: 'suspended', 3: 'revoked' } as const)[stakeholder.status] ??
              'unknown',
            subject: chain.subject,
            stakeholderUpdatedAt: stakeholder.updatedAt,
            updatedAt: chain.updatedAt,
          };
        }),
      );
      const credentials = credentialResults.filter((credential) => credential !== null);
      response.json({ credentials });
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  getMyCredential = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const session = await this.requireAuthorizedStakeholder(request);
      const stakeholder = await this.gateway.getStakeholder(session.address);
      if (/^0x0{64}$/i.test(stakeholder.credentialHash)) {
        throw new BlockchainApiError(
          'CREDENTIAL_NOT_LINKED',
          'No Company Role Credential is linked to this wallet on-chain.',
          404,
        );
      }
      const state = await this.gateway.getCredentialState(stakeholder.credentialHash);
      if (/^0x0{64}$/i.test(state.credentialId)) {
        throw new BlockchainApiError(
          'CREDENTIAL_NOT_REGISTERED',
          'The linked Company Role Credential is not registered on-chain.',
          404,
        );
      }
      const credential = await this.gateway.getCredential(state.credentialId);
      const issuance = (await this.issuanceRepository.list()).find(
        (record) =>
          record.applicantWallet.toLowerCase() === session.address.toLowerCase() &&
          record.credentialHash.toLowerCase() === credential.credentialHash.toLowerCase(),
      );
      const expired = credential.expiresAt * 1_000 <= Date.now();
      response.json({
        credential: {
          companyName: issuance?.companyName,
          companyRegistrationNumber: issuance?.companyRegistrationNumber,
          credentialHash: credential.credentialHash,
          credentialId: state.credentialId,
          encryptedCredentialCid: credential.encryptedCid,
          expiresAt: credential.expiresAt,
          issuedAt: credential.issuedAt,
          issuer: credential.issuer,
          role: session.role,
          status:
            expired && credential.status === 1
              ? 'expired'
              : (({ 1: 'active', 2: 'suspended', 3: 'revoked' } as const)[credential.status] ??
                'unknown'),
          stakeholderStatus:
            ({ 1: 'active', 2: 'suspended', 3: 'revoked' } as const)[stakeholder.status] ??
            'unknown',
          subject: credential.subject,
          updatedAt: Math.max(credential.updatedAt, stakeholder.updatedAt),
        },
      });
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  listRolePermissions = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.requireAdministrator(request);
      const names = [
        'REGISTER_INGREDIENT',
        'ISSUE_INGREDIENT_CREDENTIAL',
        'REQUEST_EVIDENCE',
        'REGISTER_PRODUCT',
        'INITIATE_TRANSFER',
        'RECEIVE_TRANSFER',
      ];
      const permissions = await Promise.all(
        names.map(async (name) => ({
          id: id(name),
          name,
          roles: Object.fromEntries(
            await Promise.all(
              [2, 3, 4, 5].map(async (role) => [
                role,
                await this.gateway.getRolePermission(role, id(name)),
              ]),
            ),
          ),
        })),
      );
      response.json({ permissions });
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  listOperationalData = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const session = await this.requireAuthorizedStakeholder(request);
      if (!this.gateway.listOperationalData)
        throw new BlockchainApiError(
          'OPERATIONAL_READS_UNAVAILABLE',
          'Operational blockchain reads are unavailable.',
          503,
        );
      response.json(await this.gateway.listOperationalData(session.address));
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  prepareCredentialLifecycle = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.requireAdministrator(request);
      const input = credentialLifecycleTransactionSchema.parse(request.body);
      const record = await this.gateway.getCredential(input.credentialId);
      const expired = record.expiresAt * 1_000 <= Date.now();
      if (input.action === 'suspend' && (record.status !== 1 || expired))
        throw new BlockchainApiError(
          'INVALID_CREDENTIAL_STATE',
          'Only an active, unexpired credential can be suspended.',
          409,
        );
      if (input.action === 'reactivate' && (record.status !== 2 || expired))
        throw new BlockchainApiError(
          'INVALID_CREDENTIAL_STATE',
          'Only a suspended, unexpired credential can be reactivated.',
          409,
        );
      if (input.action === 'revoke' && record.status === 3)
        throw new BlockchainApiError(
          'INVALID_CREDENTIAL_STATE',
          'The credential is already revoked.',
          409,
        );
      response.json(this.gateway.prepareCredentialLifecycle(input));
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  prepareStakeholderLifecycle = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      await this.requireAdministrator(request);
      const input = stakeholderLifecycleTransactionSchema.parse(request.body);
      const record = await this.gateway.getStakeholder(input.account);
      const expired = record.credentialExpiresAt * 1_000 <= Date.now();
      if (input.action === 'suspend' && record.status !== 1)
        throw new BlockchainApiError(
          'INVALID_STAKEHOLDER_STATE',
          'Only an active stakeholder can be suspended.',
          409,
        );
      if (input.action === 'reactivate' && (record.status !== 2 || expired))
        throw new BlockchainApiError(
          'INVALID_STAKEHOLDER_STATE',
          'Only a suspended stakeholder with an unexpired credential can be reactivated.',
          409,
        );
      if (input.action === 'revoke' && record.status === 3)
        throw new BlockchainApiError(
          'INVALID_STAKEHOLDER_STATE',
          'The stakeholder is already revoked.',
          409,
        );
      response.json(this.gateway.prepareStakeholderLifecycle(input));
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  prepareRolePermission = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.requireAdministrator(request);
      const input = rolePermissionTransactionSchema.parse(request.body);
      response.json(this.gateway.prepareRolePermission(input));
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  prepareApplication = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = applicationTransactionSchema.parse(request.body);
      await this.applicationMetadata.save({
        applicationId: input.applicationId,
        companyName: input.companyName,
        companyRegistrationNumber: input.companyRegistrationNumber,
        profileHash: input.profileHash,
      });
      const {
        companyName: _companyName,
        companyRegistrationNumber: _registrationNumber,
        ...transactionInput
      } = input;
      response.json(this.gateway.prepareApplication(transactionInput));
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  prepareRejection = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.requireAdministrator(request);
      const input = rejectionTransactionSchema.parse(request.body);
      response.json(this.gateway.prepareRejection(input.applicationId, input.reasonHash));
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  private async requireAdministrator(request: Request) {
    const sessionId = request.cookies?.[this.sessionCookieName] as string | undefined;
    const session = await this.authService.getSession(sessionId);
    if (
      !session.authenticated ||
      !session.authorizationReady ||
      session.role !== CompanyRole.SYSTEM_ADMIN
    ) {
      throw new BlockchainApiError(
        'ADMIN_AUTHORIZATION_REQUIRED',
        'System Admin authorization is required.',
        403,
      );
    }
  }

  private async requireAuthorizedStakeholder(request: Request) {
    const sessionId = request.cookies?.[this.sessionCookieName] as string | undefined;
    const session = await this.authService.getSession(sessionId);
    if (!session.authenticated || !session.authorizationReady || !session.address) {
      throw new BlockchainApiError(
        'STAKEHOLDER_AUTHORIZATION_REQUIRED',
        'An authorized stakeholder session is required.',
        403,
      );
    }
    return session;
  }

  private handleError(error: unknown, response: Response, next: NextFunction) {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: error.issues[0]?.message ?? 'The transaction request is invalid.',
        },
      });
      return;
    }
    if (error instanceof BlockchainApiError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  }
}

class BlockchainApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
