import {
  createAgent,
  type ICredentialIssuer,
  type ICredentialVerifier,
  type IDataStore,
  type IDataStoreORM,
  type IDIDManager,
  type IKeyManager,
  type IResolver,
  type TAgent,
} from '@veramo/core';
import { CredentialProviderJWT } from '@veramo/credential-jwt';
import { CredentialPlugin } from '@veramo/credential-w3c';
import {
  DataStoreJson,
  DIDStoreJson,
  KeyStoreJson,
  PrivateKeyStoreJson,
} from '@veramo/data-store-json';
import { DIDManager } from '@veramo/did-manager';
import { EthrDIDProvider } from '@veramo/did-provider-ethr';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { KeyManager } from '@veramo/key-manager';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { getResolver as getEthrResolver } from 'ethr-did-resolver';

import { validateTraceChainSsiConfig, type TraceChainSsiConfig } from '../config/ssi-config.js';
import { createAtomicJsonStore } from '../storage/json-file-store.js';

export const TRACECHAIN_ETHR_PROVIDER = 'did:ethr:sepolia';
const LOCAL_KMS = 'local';

type TraceChainAgentPlugins = IDIDManager &
  IKeyManager &
  IResolver &
  ICredentialIssuer &
  ICredentialVerifier &
  IDataStore &
  IDataStoreORM;

export type TraceChainAgent = TAgent<TraceChainAgentPlugins>;

/** Creates the server-side Veramo agent. This factory never reads process.env. */
export async function createTraceChainAgent(config: TraceChainSsiConfig): Promise<TraceChainAgent> {
  validateTraceChainSsiConfig(config);

  const [publicStore, privateKeyStore] = await Promise.all([
    createAtomicJsonStore(config.publicStorePath),
    createAtomicJsonStore(config.privateKeyStorePath),
  ]);

  const resolver =
    config.resolverOverrides ??
    getEthrResolver({
      networks: [
        {
          chainId: config.chainId,
          name: config.networkName,
          rpcUrl: config.rpcUrl,
        },
      ],
    });

  return createAgent<TraceChainAgentPlugins>({
    plugins: [
      new KeyManager({
        kms: {
          [LOCAL_KMS]: new KeyManagementSystem(
            new PrivateKeyStoreJson(privateKeyStore, new SecretBox(config.kmsSecretKey)),
          ),
        },
        store: new KeyStoreJson(publicStore),
      }),
      new DIDManager({
        defaultProvider: TRACECHAIN_ETHR_PROVIDER,
        providers: {
          [TRACECHAIN_ETHR_PROVIDER]: new EthrDIDProvider({
            defaultKms: LOCAL_KMS,
            networks: [
              {
                chainId: config.chainId,
                name: config.networkName,
                rpcUrl: config.rpcUrl,
              },
            ],
          }),
        },
        store: new DIDStoreJson(publicStore),
      }),
      new DIDResolverPlugin(resolver),
      new CredentialPlugin([new CredentialProviderJWT()]),
      new DataStoreJson(publicStore),
    ],
  });
}
