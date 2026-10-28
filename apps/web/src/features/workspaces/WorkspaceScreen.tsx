import { useState, type ComponentProps } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { workspacePath } from './workspace-paths';
import type { WorkspaceRole } from './workspace-navigation';
import { AdminOverview, Applications, CompanyCredentials } from './admin';
import AccessControlScreen from './admin/access-control/AccessControlPage';
import {
  SupplierOverview,
  RegisterBatch,
  IngredientBatches,
  IngredientBatchDetail,
  InformationRequests,
  SelectiveDisclosure,
  SupplierCredential,
} from './supplier';
import {
  ManufacturerOverview,
  CreateProductBatch,
  ProductBatches,
  ProductBatchDetail,
  TransferToDistributor,
  ManufacturerCredential,
} from './manufacturer';
import { IngredientEvidence } from './manufacturer/evidence/IngredientEvidencePage';
import {
  DistributorOverview,
  IncomingShipmentsList,
  IncomingShipment,
  CustodyInventory,
  DistributorTransferToRetailer,
  DistributorCredential,
} from './distributor';
import {
  RetailerOverview,
  ReceiveProductList,
  ReceiveProduct,
  QRVerification,
  ProductHistory,
  RetailerEvidenceRequests,
  RetailerCredential,
} from './retailer';
import AuditReport from './reports/AuditReportPage';
import { ScanReceiptFlow, ReceiptGatedFlow } from './receipts';

export function WorkspaceScreen({ role, page: tab }: { role: WorkspaceRole; page: string }) {
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const subView = params.get('view') ?? '';
  const activeId = params.get('id') ?? '';
  const [discReq, setDiscReq] = useState<
    ComponentProps<typeof SelectiveDisclosure>['request'] | null
  >(null);
  const nav = (tab: string) => {
    const newView = tab === 'batches-new' || tab === 'products-new';
    const page = newView ? tab.replace('-new', '') : tab;
    navigate(`${workspacePath(role, page)}${newView ? '?view=' + tab : ''}`);
  };
  const goTo = (view: string, id = '') => setSearchParams({ view, ...(id ? { id } : {}) });
  if (role === 'admin') {
    if (tab === 'overview') return <AdminOverview onNav={nav} />;
    if (tab === 'applications') return <Applications />;
    if (tab === 'credentials') return <CompanyCredentials />;
    if (tab === 'accesscontrol') return <AccessControlScreen />;
    if (tab === 'audit') return <AuditReport />;
  }

  if (role === 'supplier') {
    if (tab === 'overview') return <SupplierOverview onNav={nav} />;
    if (tab === 'batches') {
      if (subView === 'batches-new') return <RegisterBatch onBack={() => setSearchParams({})} />;
      if (subView === 'batch-detail')
        return <IngredientBatchDetail batchId={activeId} onBack={() => setSearchParams({})} />;
      return (
        <IngredientBatches
          onNew={() => goTo('batches-new')}
          onDetail={(id) => goTo('batch-detail', id)}
        />
      );
    }
    if (tab === 'requests') {
      if (discReq) return <SelectiveDisclosure request={discReq} onBack={() => setDiscReq(null)} />;
      return <InformationRequests onRespond={(req) => setDiscReq(req)} />;
    }
    if (tab === 'mycredential') return <SupplierCredential />;
    if (tab === 'audit') return <AuditReport />;
  }

  if (role === 'manufacturer') {
    if (tab === 'overview') return <ManufacturerOverview onNav={nav} />;
    if (tab === 'evidence') return <IngredientEvidence onNav={(t) => nav(t)} />;
    if (tab === 'products') {
      if (subView === 'products-new')
        return <CreateProductBatch onBack={() => setSearchParams({})} />;
      if (subView === 'product-detail')
        return (
          <ProductBatchDetail
            batchId={activeId}
            onBack={() => setSearchParams({})}
            onTransfer={() => nav('transfers')}
          />
        );
      return (
        <ProductBatches
          onNew={() => goTo('products-new')}
          onTransfer={() => nav('transfers')}
          onDetail={(id) => goTo('product-detail', id)}
        />
      );
    }
    if (tab === 'transfers') return <TransferToDistributor onBack={() => nav('products')} />;
    if (tab === 'mycredential') return <ManufacturerCredential />;
    if (tab === 'audit') return <AuditReport />;
  }

  if (role === 'distributor') {
    if (tab === 'overview') return <DistributorOverview onNav={nav} />;
    if (tab === 'incoming') {
      if (subView === 'shipment-detail')
        return <IncomingShipment shipmentId={activeId} onBack={() => setSearchParams({})} />;
      if (subView === 'scan-receipt')
        return <ScanReceiptFlow role="distributor" onDone={() => setSearchParams({})} />;
      if (subView === 'qr-gate')
        return (
          <ReceiptGatedFlow
            role="distributor"
            expectedTransferId={activeId || undefined}
            onDone={() => setSearchParams({})}
          />
        );
      return (
        <IncomingShipmentsList
          onSelect={(id) => goTo('shipment-detail', id)}
          onAccept={(_id, transferRef) => goTo('qr-gate', transferRef)}
          onScanReceipt={() => goTo('scan-receipt')}
        />
      );
    }
    if (tab === 'inventory') return <CustodyInventory onTransfer={() => nav('transfers')} />;
    if (tab === 'transfers')
      return <DistributorTransferToRetailer onBack={() => nav('inventory')} />;
    if (tab === 'mycredential') return <DistributorCredential />;
    if (tab === 'audit') return <AuditReport />;
  }

  if (role === 'retailer') {
    if (tab === 'overview') return <RetailerOverview onNav={nav} />;
    if (tab === 'receive') {
      if (subView === 'receive-detail')
        return (
          <ReceiveProduct
            shipmentId={activeId}
            onBack={() => setSearchParams({})}
            onViewHistory={(batch) =>
              navigate(
                `${workspacePath('retailer', 'history')}?view=history-detail&id=${encodeURIComponent(batch)}`,
              )
            }
          />
        );
      if (subView === 'scan-receipt')
        return <ScanReceiptFlow role="retailer" onDone={() => setSearchParams({})} />;
      if (subView === 'qr-gate')
        return (
          <ReceiptGatedFlow
            role="retailer"
            expectedTransferId={activeId || undefined}
            onDone={() => setSearchParams({})}
          />
        );
      return (
        <ReceiveProductList
          onSelect={(id) => goTo('receive-detail', id)}
          onAccept={(_id, transferRef) => goTo('qr-gate', transferRef)}
          onScanReceipt={() => goTo('scan-receipt')}
        />
      );
    }
    if (tab === 'scan')
      return <QRVerification initialBatch={activeId || undefined} onBack={() => nav('overview')} />;
    if (tab === 'history') {
      if (subView === 'history-detail')
        return <QRVerification initialBatch={activeId} onBack={() => setSearchParams({})} />;
      return <ProductHistory onView={(batch) => goTo('history-detail', batch)} />;
    }
    if (tab === 'evidence') return <RetailerEvidenceRequests />;
    if (tab === 'mycredential') return <RetailerCredential />;
    if (tab === 'audit') return <AuditReport />;
  }

  return null;
}
