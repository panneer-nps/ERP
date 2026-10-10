"use client";
import {useParams} from "next/navigation";
import PurchaseDetailView from "../../purchase-detail-view";
export default function PurchaseOrderDetailPage(){const params=useParams<{id:string}>();return <PurchaseDetailView id={params.id} kind="order"/>;}
