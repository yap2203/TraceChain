// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import {IStakeholderRegistry} from '../interfaces/IStakeholderRegistry.sol';
import {IProductRegistry} from '../interfaces/IProductRegistry.sol';

interface IProductDeliveryOrders {
    function locationOwner(bytes32) external view returns (address);
    function deliveryOrderContext(bytes32) external view returns (address,address,bytes32,uint256,uint64,uint8);
    function requestDecision(bytes32) external view returns (uint8,bytes32,string memory,uint64);
}
interface IProductDeliveryCustody {
    function supplyOrders() external view returns (address);
    function reserveProductDelivery(bytes32,address,bytes32,uint256) external;
    function releaseProductDelivery(bytes32,address,bytes32,uint256) external;
    function dispatchProductDelivery(bytes32,ProductDelivery.Route calldata,ProductDelivery.Transport calldata) external;
}

/// Per-order carrier orchestration; only CustodyTransfer holds and settles product balances.
contract ProductDelivery {
    struct Record {
        address manufacturer; address retailer; address distributor; bytes32 batchId;
        bytes32 fromLocation; bytes32 toLocation; uint256 quantity;
        uint64 assignmentDeadline; uint64 acceptedAt; uint64 dispatchedAt; uint64 deliveredAt;
        uint8 mode; uint8 stage; bytes32 transferId;
        bool reservationActive;
        bytes32 identityChallenge; bytes32 identityCredentialHash; uint64 identityValidUntil;
    }
    struct Transport { bytes32 transferId; uint64 occurredAt; uint64 expectedAt; string vehicle; bytes32 detailsHash; string cid; }
    struct Route {bytes32 batchId;address holder;address retailer;address distributor;bytes32 fromLocation;bytes32 toLocation;uint256 quantity;}
    struct Context { address manufacturer; address retailer; bytes32 batchId; uint256 quantity; uint64 expiresAt; uint8 status; }
    error Unauthorized(); error InvalidState();
    IProductDeliveryCustody public immutable custody;
    IStakeholderRegistry private immutable stakeholders;
    IProductRegistry private immutable products;
    mapping(bytes32=>Record) private records;
    event ProductDeliveryChanged(bytes32 indexed orderId,address indexed distributor,uint8 mode,uint8 stage);
    constructor(address parent,address registry,address productRegistry) {
        custody=IProductDeliveryCustody(parent);stakeholders=IStakeholderRegistry(registry);products=IProductRegistry(productRegistry);
    }
    function policy() external pure returns(uint8){return 1;}
    function context(bytes32 orderId) private view returns(Context memory c){
        (c.manufacturer,c.retailer,c.batchId,c.quantity,c.expiresAt,c.status)=IProductDeliveryOrders(custody.supplyOrders()).deliveryOrderContext(orderId);
    }
    function get(bytes32 orderId) public view returns(Record memory r){
        r=records[orderId];Context memory c=context(orderId);
        if(r.stage>0 && r.stage<4 && (c.status!=1 || c.expiresAt<=block.timestamp || (r.stage==1&&r.assignmentDeadline<=block.timestamp)))r.stage=6;
    }
    function role(address actor,uint8 value,string memory permission) private view {
        if(!stakeholders.isAuthorized(actor,value)||!stakeholders.hasPermission(actor,keccak256(bytes(permission))))revert Unauthorized();
    }
    function active(Context memory c) private view {
        role(c.manufacturer,3,'INITIATE_TRANSFER');role(c.retailer,5,'RECEIVE_TRANSFER');
        if(c.status!=1||c.expiresAt<=block.timestamp||c.quantity==0||products.manufacturerOf(c.batchId)!=c.manufacturer||!products.isTransferable(c.batchId))revert InvalidState();
    }
    function select(bytes32 orderId,uint8 mode,address distributor,bytes32 fromLocation,bytes32 toLocation) external {
        Context memory c=context(orderId);active(c);
        if(msg.sender!=c.manufacturer)revert Unauthorized();
        IProductDeliveryOrders orders=IProductDeliveryOrders(custody.supplyOrders());
        (uint8 decision,,,uint64 approvedAt)=orders.requestDecision(orderId);
        Record storage r=records[orderId];
        if(decision!=1||(mode!=1&&mode!=2)||(r.stage!=0&&get(orderId).stage!=1))revert InvalidState();
        uint64 deadline=approvedAt+48 hours;if(deadline>c.expiresAt)deadline=c.expiresAt;
        if(deadline<=block.timestamp||orders.locationOwner(toLocation)!=c.retailer||orders.locationOwner(fromLocation)!=(mode==1?c.manufacturer:distributor))revert InvalidState();
        role(distributor,4,'RECEIVE_TRANSFER');role(distributor,4,'INITIATE_TRANSFER');
        r.manufacturer=c.manufacturer;r.retailer=c.retailer;r.distributor=distributor;r.batchId=c.batchId;
        r.fromLocation=fromLocation;r.toLocation=toLocation;r.quantity=c.quantity;r.assignmentDeadline=deadline;
        r.mode=mode;r.stage=mode==1?2:3;r.acceptedAt=mode==2?uint64(block.timestamp):0;
        delete r.identityChallenge;delete r.identityCredentialHash;delete r.identityValidUntil;
        if(mode==2){custody.reserveProductDelivery(c.batchId,distributor,fromLocation,c.quantity);r.reservationActive=true;}
        emit ProductDeliveryChanged(orderId,distributor,mode,r.stage);
    }
    function respond(bytes32 orderId,bool accept) external {
        Record storage r=records[orderId];active(context(orderId));
        role(msg.sender,4,'RECEIVE_TRANSFER');
        if(msg.sender!=r.distributor)revert Unauthorized();
        if(r.mode!=1||get(orderId).stage!=2)revert InvalidState();
        r.stage=accept?3:1;r.acceptedAt=accept?uint64(block.timestamp):0;
        if(!accept){r.distributor=address(0);delete r.identityChallenge;delete r.identityCredentialHash;delete r.identityValidUntil;}
        emit ProductDeliveryChanged(orderId,r.distributor,1,r.stage);
    }
    function dispatch(bytes32 orderId,Transport calldata input) external {
        Record storage r=records[orderId];active(context(orderId));
        role(msg.sender,4,'INITIATE_TRANSFER');
        if(msg.sender!=r.distributor)revert Unauthorized();
        if(get(orderId).stage!=3||input.occurredAt==0||input.occurredAt>block.timestamp||input.occurredAt<r.acceptedAt||input.expectedAt<=block.timestamp||input.transferId==bytes32(0))revert InvalidState();
        bool meaningful;bytes memory vehicle=bytes(input.vehicle);
        if(vehicle.length<2||vehicle.length>32)revert InvalidState();
        for(uint256 i;i<vehicle.length;++i){bytes1 c=vehicle[i];if(!((c>=0x30&&c<=0x39)||(c>=0x41&&c<=0x5a)||c==0x20||c==0x2d))revert InvalidState();if(c!=0x20&&c!=0x2d)meaningful=true;}
        if(!meaningful)revert InvalidState();
        if(r.identityChallenge!=bytes32(0)&&(r.identityValidUntil<=block.timestamp||r.identityCredentialHash!=stakeholders.credentialHashOf(r.manufacturer)))revert InvalidState();
        if(r.mode==1)custody.reserveProductDelivery(r.batchId,r.manufacturer,r.fromLocation,r.quantity);
        r.stage=4;r.transferId=input.transferId;r.dispatchedAt=input.occurredAt;
        custody.dispatchProductDelivery(orderId,Route(r.batchId,r.mode==1?r.manufacturer:r.distributor,r.retailer,r.distributor,r.fromLocation,r.toLocation,r.quantity),input);
        r.reservationActive=false;
        emit ProductDeliveryChanged(orderId,r.distributor,r.mode,4);
    }
    function close(bytes32 orderId) external {
        Record storage r=records[orderId];
        if(msg.sender!=r.manufacturer&&msg.sender!=r.distributor&&msg.sender!=r.retailer)revert Unauthorized();
        if(r.stage==0||r.stage>=4)revert InvalidState();
        if(get(orderId).stage!=6&&msg.sender!=r.manufacturer)revert Unauthorized();
        if(r.reservationActive){custody.releaseProductDelivery(r.batchId,r.distributor,r.fromLocation,r.quantity);r.reservationActive=false;}
        r.stage=6;emit ProductDeliveryChanged(orderId,r.distributor,r.mode,6);
    }
    function complete(bytes32 orderId,bytes32 transferId,uint64 occurredAt) external {
        Record storage r=records[orderId];if(msg.sender!=address(custody)||r.stage!=4||r.transferId!=transferId)revert Unauthorized();
        r.stage=5;r.deliveredAt=occurredAt;emit ProductDeliveryChanged(orderId,r.distributor,r.mode,5);
    }
    function cancelAfterReconciliation(bytes32 orderId,bytes32 transferId) external {
        Record storage r=records[orderId];if(msg.sender!=address(custody)||r.stage!=4||r.transferId!=transferId)revert Unauthorized();
        r.stage=6;emit ProductDeliveryChanged(orderId,r.distributor,r.mode,6);
    }
    // Same challenge/attestation argument shape as the existing delivery company-proof adapter.
    function act(uint8 action,address actor,bytes32 orderId,address,bytes32 challenge,uint64,bytes32 credentialHash,bytes32 presentationHash,uint64 validUntil) external {
        Record storage r=records[orderId];Context memory c=context(orderId);active(c);
        role(actor,4,'RECEIVE_TRANSFER');
        if(actor!=msg.sender||actor!=r.distributor)revert Unauthorized();
        uint8 stage=get(orderId).stage;
        if((stage!=2&&stage!=3)||challenge==bytes32(0)||validUntil<=block.timestamp||validUntil>c.expiresAt)revert InvalidState();
        if(action==4){
            if(r.identityValidUntil>block.timestamp)revert InvalidState();
            r.identityChallenge=challenge;r.identityCredentialHash=bytes32(0);r.identityValidUntil=validUntil;
        }else if(action==5){
            if(challenge!=r.identityChallenge||r.identityCredentialHash!=bytes32(0)||credentialHash!=stakeholders.credentialHashOf(r.manufacturer)||presentationHash==bytes32(0)||validUntil>r.identityValidUntil)revert InvalidState();
            r.identityCredentialHash=credentialHash;r.identityValidUntil=validUntil;
        }else revert InvalidState();
    }
}
