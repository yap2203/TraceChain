import { useState, type ComponentProps } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { workspacePath } from './workspace-paths';
import type { WorkspaceRole } from './workspace-navigation';
import { AdminOverview, Applications, CompanyCredentials, DiscrepancyManagement } from './admin';
import AccessControlScreen from './admin/access-control/AccessControlPage';
import AdminAuditReport from './admin/audit/AdminAuditReport';
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
  ManufacturerCredential,
} from './manufacturer';
import { IngredientEvidence } from './manufacturer/evidence/IngredientEvidencePage';
import { CompanyProfilePage } from '../orders/CompanyProfilePage';
import { TraceabilityWorkspace } from '../product-traceability/TraceabilityWorkspace';
import { DistributorOverview, DistributorCredential } from './distributor';
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
import { OrdersPage } from '../orders/OrdersPage';
import { ShipmentsWorkspace } from '../orders/ShipmentsWorkspace';
import { CustodyInventoryPage } from '../orders/CustodyInventoryPage';
import { InformationRequestsWorkspace } from '../orders/InformationRequestsWorkspace';
import { CustodyOffersWorkspace } from '../orders/CustodyOffersWorkspace';

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
  if (tab === 'transfers' && (role === 'supplier' || role === 'manufacturer'))
    return <CustodyOffersWorkspace role={role} />;
  if (tab === 'intake' && role === 'distributor')
    return <CustodyOffersWorkspace role={role} receiver />;
  if (tab === 'profile' && role !== 'admin') return <CompanyProfilePage role={role} />;
  if (tab === 'traceability' && role !== 'admin') return <TraceabilityWorkspace role={role} />;
  if (
    ['inventory', 'product-inventory'].includes(tab) &&
    ['supplier', 'distributor', 'manufacturer'].includes(role)
  )
    return (
      <CustodyInventoryPage
        key={tab}
        role={role as 'supplier' | 'distributor' | 'manufacturer'}
        initialKind={
          tab === 'product-inventory' || role === 'manufacturer' ? 'product' : 'ingredient'
        }
      />
    );
  if (tab === 'requests' || tab === 'sent-requests') {
    const direction = tab === 'sent-requests' ? 'sent' : 'received';
    return (
      <InformationRequestsWorkspace key={tab} role={role} initialDirection={direction}>
        {role === 'supplier' && direction === 'received' ? (
          discReq ? (
            <SelectiveDisclosure request={discReq} onBack={() => setDiscReq(null)} />
          ) : (
            <InformationRequests onRespond={setDiscReq} initialDirection="received" hideDirection />
          )
        ) : role === 'manufacturer' && direction === 'sent' ? (
          <IngredientEvidence
            onNav={nav}
            hideComposer={!params.get('batchId')}
            initialBatchId={params.get('batchId') ?? undefined}
          />
        ) : role === 'retailer' && direction === 'sent' ? (
          <RetailerEvidenceRequests
            embedded
            initialProductBatchId={params.get('productBatchId') ?? undefined}
            initialIngredientBatchId={params.get('batchId') ?? undefined}
          />
        ) : undefined}
      </InformationRequestsWorkspace>
    );
  }
  if (role !== 'admin' && ['shipments', 'product-shipments', 'arrivals'].includes(tab))
    return (
      <ShipmentsWorkspace
        key={`${role}-${tab}`}
        role={role}
        section={tab === 'arrivals' ? 'intake' : role === 'distributor' ? 'deliveries' : 'tracking'}
        initialKind={
          role === 'retailer' ||
          tab === 'product-shipments' ||
          (tab === 'transfers' && role === 'manufacturer')
            ? 'product'
            : 'ingredient'
        }
        initialView="shipments"
        initialShipmentId={params.get('shipmentId') ?? ''}
        initialOrderId={params.get('orderId') ?? ''}
        initialBatchId={params.get('batchId') ?? ''}
      />
    );
  if (
    role !== 'admin' &&
    role !== 'distributor' &&
    ['orders', 'product-orders', 'browse', 'ingredients'].includes(tab)
  )
    return (
      <OrdersPage
        key={tab}
        role={role}
        initialOrderId={params.get('orderId') ?? ''}
        initialBatchId={params.get('batchId') ?? ''}
        mode={['browse', 'ingredients'].includes(tab) ? 'browse' : 'manage'}
        fixedDirection={role === 'supplier' || tab === 'product-orders' ? 'received' : 'sent'}
      />
    );
  if (role === 'admin') {
    if (tab === 'overview') return <AdminOverview onNav={nav} />;
    if (tab === 'applications') return <Applications />;
    if (['credentials', 'accesscontrol', 'stakeholders'].includes(tab))
      return <CompanyCredentials />;
    if (['roles', 'matrix'].includes(tab))
      return <AccessControlScreen key={tab} section={tab as 'roles' | 'matrix'} />;
    if (tab === 'discrepancies') return <DiscrepancyManagement />;
    if (tab === 'audit') return <AdminAuditReport />;
  }

  if (role === 'supplier') {
    if (tab === 'overview') return <SupplierOverview onNav={nav} />;
    if (tab === 'batches') {
      if (subView === 'batches-new')
        return (
          <RegisterBatch
            onBack={() => setSearchParams({})}
            onCompleted={() => setSearchParams({})}
          />
        );
      if (subView === 'batch-detail')
        return <IngredientBatchDetail batchId={activeId} onBack={() => setSearchParams({})} />;
      return <IngredientBatches onNew={() => goTo('batches-new')} />;
    }
    if (tab === 'mycredential') return <SupplierCredential />;
    if (tab === 'audit') return <AuditReport />;
  }

  if (role === 'manufacturer') {
    if (tab === 'overview') return <ManufacturerOverview onNav={nav} />;
    if (tab === 'products') {
      if (subView === 'products-new')
        return <CreateProductBatch onBack={() => setSearchParams({})} />;
      if (subView === 'product-detail')
        return (
          <ProductBatchDetail
            batchId={activeId}
            onBack={() => setSearchParams({})}
            onTransfer={() => nav('transfers')}
            onIngredientDetail={(batchId) =>
              navigate(
                workspacePath(role, 'ingredients') + '?batchId=' + encodeURIComponent(batchId),
              )
            }
          />
        );
      return (
        <ProductBatches
          section={subView === 'ingredients' ? 'ingredients' : 'products'}
          ingredientBatchId={params.get('batchId') ?? undefined}
          onSectionChange={(section) =>
            setSearchParams(section === 'ingredients' ? { view: 'ingredients' } : {})
          }
          onNew={() => goTo('products-new')}
          onTransfer={() => nav('transfers')}
          onDetail={(id) => goTo('product-detail', id)}
        />
      );
    }
    if (tab === 'mycredential') return <ManufacturerCredential />;
    if (tab === 'audit') return <AuditReport />;
  }

  if (role === 'distributor') {
    if (tab === 'overview') return <DistributorOverview onNav={nav} />;
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
      return (
        <ProductHistory
          onView={(batch) =>
            navigate(
              workspacePath(role, 'traceability') +
                '?' +
                new URLSearchParams({ kind: 'product', batchId: batch }),
            )
          }
        />
      );
    }
    if (tab === 'mycredential') return <RetailerCredential />;
    if (tab === 'audit') return <AuditReport />;
  }

  return null;
}
