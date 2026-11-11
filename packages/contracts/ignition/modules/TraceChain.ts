import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('TraceChain', (module) => {
  const administrator = module.getAccount(0);
  const stakeholders = module.contract('StakeholderRegistry', [administrator]);
  const credentials = module.contract('CredentialRegistry', [stakeholders]);
  module.call(stakeholders, 'configureCredentialRegistry', [credentials]);
  const evidence = module.contract('EvidenceRegistry', [stakeholders, credentials]);
  const ingredients = module.contract('IngredientRegistry', [stakeholders, credentials]);
  module.call(evidence, 'configureIngredientRegistry', [ingredients]);
  const products = module.contract('ProductRegistry', [stakeholders, ingredients, evidence]);
  module.call(ingredients, 'configureProductRegistry', [products]);
  const custody = module.contract('CustodyTransfer', [stakeholders, products]);
  const orders = module.contract('SupplyChainOrders', [
    stakeholders,
    ingredients,
    products,
    evidence,
    custody,
  ]);
  module.call(ingredients, 'configureSupplyOrders', [orders]);
  module.call(custody, 'configureSupplyOrders', [orders]);
  return { stakeholders, credentials, evidence, ingredients, products, custody, orders };
});
