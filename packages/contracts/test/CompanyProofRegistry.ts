import { expect } from 'chai';
import { network } from 'hardhat';
const { ethers, networkHelpers } = await network.create();

describe('Company proof shared references', () => {
  async function fixture() {
    const [admin, supplier, manufacturer, retailer, distributor, stranger] =
      await ethers.getSigners();
    const stakeholders = await ethers.deployContract('StakeholderRegistry', [admin.address]);
    const credentials = await ethers.deployContract('CredentialRegistry', [stakeholders]);
    await stakeholders.configureCredentialRegistry(credentials);
    const expiry = (await networkHelpers.time.latest()) + 3600;
    for (const [signer, role] of [
      [supplier, 2],
      [manufacturer, 3],
      [retailer, 5],
      [distributor, 4],
    ] as const) {
      const application = ethers.id('application:' + signer.address),
        hash = ethers.id('vc:' + signer.address);
      await stakeholders
        .connect(signer)
        .submitApplication(
          application,
          ethers.id('profile'),
          'ipfs:encrypted',
          role,
          ethers.ZeroHash,
        );
      await credentials.registerCredential(
        ethers.id('credential:' + signer.address),
        hash,
        'ipfs:vc',
        signer.address,
        1,
        expiry,
      );
      await stakeholders.approveApplication(application, hash, 'ipfs:vc', expiry);
    }
    const proofs = await ethers.deployContract('CompanyProofRegistry', [stakeholders]);
    return {
      admin,
      supplier,
      manufacturer,
      retailer,
      distributor,
      stranger,
      stakeholders,
      proofs,
      expiry,
    };
  }
  it('lets Manufacturer/Retailer presenters publish once and keeps verification separate', async () => {
    const f = await networkHelpers.loadFixture(fixture);
    for (const presenter of [f.manufacturer, f.retailer]) {
      const request = ethers.id(presenter.address),
        challenge = ethers.id('challenge:' + request);
      await f.proofs
        .connect(f.supplier)
        .request(
          request,
          presenter.address,
          challenge,
          f.expiry,
          ethers.id('encrypted request'),
          'ipfs:request',
        );
      await expect(
        f.proofs
          .connect(f.stranger)
          .respond(request, challenge, ethers.id('response'), 'ipfs:response'),
      ).to.revert(ethers);
      await f.proofs
        .connect(presenter)
        .respond(request, challenge, ethers.id('response'), 'ipfs:response');
      await f.proofs
        .connect(presenter)
        .respond(request, challenge, ethers.id('response'), 'ipfs:response');
      expect((await f.proofs.get(request)).status).to.equal(2);
      await expect(
        f.proofs
          .connect(presenter)
          .respond(request, challenge, ethers.id('different response'), 'ipfs:response'),
      ).to.revert(ethers);
      await expect(f.proofs.connect(presenter).review(request, false)).to.revert(ethers);
      await f.proofs.connect(f.supplier).review(request, false);
      expect((await f.proofs.get(request)).status).to.equal(3);
    }
  });
  it('binds delivery verifier/presenter, challenge, expiry and current authorization', async () => {
    const f = await networkHelpers.loadFixture(fixture),
      request = ethers.id('delivery'),
      challenge = ethers.id('fresh');
    await f.proofs
      .connect(f.distributor)
      .request(
        request,
        f.supplier.address,
        challenge,
        f.expiry,
        ethers.id('request'),
        'ipfs:request',
      );
    await expect(
      f.proofs
        .connect(f.supplier)
        .respond(request, ethers.id('wrong challenge'), ethers.id('response'), 'ipfs:response'),
    ).to.revert(ethers);
    await f.stakeholders.suspendStakeholder(f.supplier.address, ethers.id('reason'));
    await expect(
      f.proofs
        .connect(f.supplier)
        .respond(request, challenge, ethers.id('response'), 'ipfs:response'),
    ).to.revert(ethers);
    await f.stakeholders.reactivateStakeholder(f.supplier.address);
    await networkHelpers.time.increaseTo(f.expiry);
    await expect(
      f.proofs
        .connect(f.supplier)
        .respond(request, challenge, ethers.id('response'), 'ipfs:response'),
    ).to.revert(ethers);
  });
  it('supports explicit decline and issuer-source-bound wallet attestation references', async () => {
    const f = await networkHelpers.loadFixture(fixture);
    const hash = ethers.id('vc:' + f.manufacturer.address);
    await f.proofs
      .connect(f.manufacturer)
      .registerBinding(hash, ethers.id('signed attestation'), 'ipfs:binding');
    expect((await f.proofs.bindings(f.manufacturer.address)).sourceHash).to.equal(hash);
    await expect(
      f.proofs
        .connect(f.retailer)
        .registerBinding(hash, ethers.id('signed attestation'), 'ipfs:binding'),
    ).to.revert(ethers);
    const request = ethers.id('decline');
    await f.proofs
      .connect(f.supplier)
      .request(
        request,
        f.manufacturer.address,
        ethers.id('challenge'),
        f.expiry,
        ethers.id('request'),
        'ipfs:request',
      );
    await f.proofs.connect(f.manufacturer).review(request, true);
    expect((await f.proofs.get(request)).status).to.equal(4);
    // A requested proof cannot be rejected before a response exists.
    await expect(f.proofs.connect(f.supplier).reject(request, ethers.id('reason'))).to.revert(
      ethers,
    );
    await expect(
      f.proofs
        .connect(f.manufacturer)
        .respond(request, ethers.id('challenge'), ethers.id('response'), 'ipfs:response'),
    ).to.revert(ethers);
  });
  it('lets only the verifier reject a shared response, with a reason hash', async () => {
    const f = await networkHelpers.loadFixture(fixture);
    const request = ethers.id('reject');
    await f.proofs
      .connect(f.supplier)
      .request(
        request,
        f.manufacturer.address,
        ethers.id('challenge'),
        f.expiry,
        ethers.id('request'),
        'ipfs:request',
      );
    await f.proofs
      .connect(f.manufacturer)
      .respond(request, ethers.id('challenge'), ethers.id('response'), 'ipfs:response');
    await expect(f.proofs.connect(f.manufacturer).reject(request, ethers.id('reason'))).to.revert(
      ethers,
    );
    await expect(f.proofs.connect(f.supplier).reject(request, ethers.ZeroHash)).to.revert(ethers);
    await f.proofs.connect(f.supplier).reject(request, ethers.id('reason'));
    expect((await f.proofs.get(request)).status).to.equal(5);
    await expect(f.proofs.connect(f.supplier).review(request, false)).to.revert(ethers);
  });
});
