import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api=process.env.ERP_VERIFY_API_URL??"http://127.0.0.1:44001";
async function main(){
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  const owner=await pool.query<{id:string;company_id:string}>(`SELECT u.id,u.company_id FROM users u JOIN user_roles ur ON ur.company_id=u.company_id AND ur.user_id=u.id JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE r.code='owner' AND u.active=true ORDER BY u.created_at LIMIT 1`);
  if(!owner.rowCount)throw new Error("No active owner is available for the temporary read-only session.");
  const user=owner.rows[0],token=randomBytes(32).toString("base64url"),hash=createHash("sha256").update(token).digest("hex");
  const session=await pool.query<{id:string}>(`INSERT INTO sessions(user_id,company_id,token_hash,expires_at,user_agent) VALUES($1,$2,$3,now()+interval '5 minutes','read-only purchase-detail verification') RETURNING id`,[user.id,user.company_id,hash]);
  let supplierId="",productId="",orderId="",orderLineId="",receiptId="",billId="",billLineId="",returnId="";
  try{
    const client=await pool.connect();const suffix=randomBytes(5).toString("hex");
    try{
      await client.query("BEGIN");
      const supplier=await client.query<{id:string}>("INSERT INTO business_partners(company_id,partner_type,name,code) VALUES($1,'supplier',$2,$3) RETURNING id",[user.company_id,"Detail verification supplier",`VERIFY-${suffix}`]);supplierId=supplier.rows[0].id;
      const product=await client.query<{id:string}>("INSERT INTO products(company_id,name,code,unit) VALUES($1,'Detail verification product',$2,'pieces') RETURNING id",[user.company_id,`VERIFY-${suffix}`]);productId=product.rows[0].id;
      await client.query("INSERT INTO product_units(company_id,product_id,code,label,conversion_to_base,is_base,created_by) VALUES($1,$2,'PIECES','pieces',1,true,$3)",[user.company_id,productId,user.id]);
      const order=await client.query<{id:string}>("INSERT INTO purchase_orders(company_id,order_number,supplier_id,order_date,status,subtotal,tax_total,total,created_by) VALUES($1,$2,$3,current_date,'billed',100,0,100,$4) RETURNING id",[user.company_id,`VERIFY-${suffix}`,supplierId,user.id]);orderId=order.rows[0].id;
      const orderLine=await client.query<{id:string}>("INSERT INTO purchase_order_lines(company_id,order_id,line_number,product_id,quantity,unit_rate,tax_rate,line_subtotal,tax_amount,line_total,received_quantity,billed_quantity,entered_quantity,entered_unit_code,conversion_to_base) VALUES($1,$2,1,$3,10,10,0,100,0,100,10,10,10,'PIECES',1) RETURNING id",[user.company_id,orderId,productId]);orderLineId=orderLine.rows[0].id;
      const receipt=await client.query<{id:string}>("INSERT INTO purchase_receipts(company_id,receipt_number,order_id,supplier_id,receipt_date,notes,created_by) VALUES($1,$2,$3,$4,current_date,'verification fixture',$5) RETURNING id",[user.company_id,`VERIFY-${suffix}`,orderId,supplierId,user.id]);receiptId=receipt.rows[0].id;
      await client.query("INSERT INTO purchase_receipt_lines(company_id,receipt_id,order_line_id,product_id,quantity,unit_rate,tax_rate,line_subtotal,entered_quantity,entered_unit_code,conversion_to_base) VALUES($1,$2,$3,$4,10,10,0,100,10,'PIECES',1)",[user.company_id,receiptId,orderLineId,productId]);
      const bill=await client.query<{id:string}>("INSERT INTO purchase_bills(company_id,bill_number,supplier_invoice_number,order_id,supplier_id,bill_date,subtotal,tax_total,total,created_by) VALUES($1,$2,$3,$4,$5,current_date,$6,0,$6,$7) RETURNING id",[user.company_id,`VERIFY-${suffix}`,`TEST-${suffix}`,orderId,supplierId,100,user.id]);billId=bill.rows[0].id;
      const billLine=await client.query<{id:string}>("INSERT INTO purchase_bill_lines(company_id,bill_id,line_number,product_id,quantity,unit_rate,tax_rate,line_subtotal,tax_amount,line_total,order_line_id) VALUES($1,$2,1,$3,10,10,0,100,0,100,$4) RETURNING id",[user.company_id,billId,productId,orderLineId]);billLineId=billLine.rows[0].id;
      await client.query("INSERT INTO supplier_payments(company_id,payment_number,supplier_id,bill_id,payment_date,amount,payment_method,reference,created_by) VALUES($1,$2,$3,$4,current_date,20,'bank_transfer','test',$5)",[user.company_id,`VERIFY-${suffix}`,supplierId,billId,user.id]);
      const ret=await client.query<{id:string}>("INSERT INTO purchase_returns(company_id,return_number,bill_id,supplier_id,return_date,reason,subtotal,tax_total,total,created_by) VALUES($1,$2,$3,$4,current_date,'verification fixture',10,0,10,$5) RETURNING id",[user.company_id,`VERIFY-${suffix}`,billId,supplierId,user.id]);returnId=ret.rows[0].id;
      await client.query("INSERT INTO purchase_return_lines(company_id,purchase_return_id,bill_line_id,product_id,quantity,unit_rate,tax_rate,line_subtotal,tax_amount,line_total,entered_quantity,entered_unit_code,conversion_to_base) VALUES($1,$2,$3,$4,1,10,0,10,0,10,1,'PIECES',1)",[user.company_id,returnId,billLineId,productId]);
      await client.query("INSERT INTO purchase_return_allocations(company_id,purchase_return_id,bill_id,supplier_id,amount,allocation_date,reason,created_by) VALUES($1,$2,$3,$4,5,current_date,'verification fixture',$5)",[user.company_id,returnId,billId,supplierId,user.id]);
      await client.query("INSERT INTO purchase_return_refunds(company_id,refund_number,purchase_return_id,supplier_id,refund_date,amount,payment_method,reference,reason,created_by) VALUES($1,$2,$3,$4,current_date,2,'cash','test','verification fixture',$5)",[user.company_id,`VERIFY-${suffix}`,returnId,supplierId,user.id]);
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK").catch(()=>undefined);throw e;}finally{client.release();}
    const [orderResponse,billResponse]=await Promise.all([
      fetch(`${api}/api/purchases/orders/${orderId}`,{headers:{Authorization:`Bearer ${token}`}}),
      fetch(`${api}/api/purchases/bills/${billId}`,{headers:{Authorization:`Bearer ${token}`}}),
    ]);
    const [orderData,billData]=await Promise.all([orderResponse.json(),billResponse.json()]);
    const check={check:"purchase-detail-runtime",orderStatus:orderResponse.status,orderPayloadValid:orderResponse.ok&&orderData.order?.id===orderId&&orderData.lines?.length===1&&orderData.receipts?.length===1&&orderData.bills?.length===1&&orderData.audit?.length>=0,billStatus:billResponse.status,billPayloadValid:billResponse.ok&&billData.bill?.id===billId&&billData.lines?.length===1&&billData.receipts?.length===1&&billData.payments?.length===1&&billData.returns?.length===1&&billData.creditAllocations?.length===1&&billData.refunds?.length===1&&billData.audit?.length>=0};
    console.log(JSON.stringify(check));
    if(!check.orderPayloadValid||!check.billPayloadValid)process.exitCode=1;
  }finally{
    if(returnId){await pool.query("DELETE FROM purchase_return_refunds WHERE company_id=$1 AND purchase_return_id=$2",[user.company_id,returnId]);await pool.query("DELETE FROM purchase_return_allocations WHERE company_id=$1 AND purchase_return_id=$2",[user.company_id,returnId]);await pool.query("DELETE FROM purchase_return_lines WHERE company_id=$1 AND purchase_return_id=$2",[user.company_id,returnId]);await pool.query("DELETE FROM purchase_returns WHERE company_id=$1 AND id=$2",[user.company_id,returnId]);}
    if(billId){await pool.query("DELETE FROM supplier_payments WHERE company_id=$1 AND bill_id=$2",[user.company_id,billId]);await pool.query("DELETE FROM purchase_bill_lines WHERE company_id=$1 AND bill_id=$2",[user.company_id,billId]);await pool.query("DELETE FROM purchase_bills WHERE company_id=$1 AND id=$2",[user.company_id,billId]);}
    if(receiptId){await pool.query("DELETE FROM purchase_receipt_lines WHERE company_id=$1 AND receipt_id=$2",[user.company_id,receiptId]);await pool.query("DELETE FROM purchase_receipts WHERE company_id=$1 AND id=$2",[user.company_id,receiptId]);}
    if(orderId){await pool.query("DELETE FROM purchase_order_lines WHERE company_id=$1 AND order_id=$2",[user.company_id,orderId]);await pool.query("DELETE FROM purchase_orders WHERE company_id=$1 AND id=$2",[user.company_id,orderId]);}
    if(productId){await pool.query("DELETE FROM product_units WHERE company_id=$1 AND product_id=$2",[user.company_id,productId]);await pool.query("DELETE FROM products WHERE company_id=$1 AND id=$2",[user.company_id,productId]);}
    if(supplierId)await pool.query("DELETE FROM business_partners WHERE company_id=$1 AND id=$2",[user.company_id,supplierId]);
    await pool.query("DELETE FROM sessions WHERE id=$1",[session.rows[0].id]);
  }
  await pool.end();
}
main().catch(async(error)=>{console.error("Purchase detail runtime verification failed:",error instanceof Error?error.message:"unknown error");await pool.end();process.exitCode=1;});
