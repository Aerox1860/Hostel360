import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

export interface InvoiceData {
  invoice_no?: string;
  plan_name?: string;
  months?: number;
  amount?: number;
  method?: string;
  start?: string;
  end?: string;
  created_at?: string;
  hostel_name?: string;
}

function fdate(s?: string) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return s;
  }
}

function buildHtml(sub: InvoiceData, ownerName: string, hostelName: string) {
  const amt = sub.amount ?? 0;
  const method = (sub.method || "online").toUpperCase();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1A1D1A;padding:32px;background:#fff;}
    .brand{display:flex;align-items:center;gap:10px;}
    .logo{width:44px;height:44px;border-radius:10px;background:#2C5E3E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;}
    .title{font-size:22px;font-weight:800;} .accent{color:#D97706;}
    .muted{color:#6A706A;font-size:13px;}
    .row{display:flex;justify-content:space-between;align-items:flex-start;margin-top:24px;}
    .box{background:#F4F5F4;border-radius:12px;padding:16px;margin-top:24px;}
    table{width:100%;border-collapse:collapse;margin-top:24px;}
    th{ text-align:left;font-size:12px;color:#6A706A;border-bottom:2px solid #E5E7E5;padding:10px 8px;text-transform:uppercase;}
    td{padding:14px 8px;border-bottom:1px solid #E5E7E5;font-size:14px;}
    .total{display:flex;justify-content:flex-end;margin-top:20px;}
    .total .amt{font-size:26px;font-weight:800;color:#2C5E3E;}
    .badge{display:inline-block;background:#E3ECE5;color:#1D402A;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;}
    .footer{margin-top:40px;border-top:1px solid #E5E7E5;padding-top:16px;font-size:12px;color:#6A706A;}
  </style></head><body>
    <div class="row" style="margin-top:0;">
      <div class="brand"><div class="logo">H</div><div><div class="title">Hostel <span class="accent">360</span></div><div class="muted">Subscription Invoice</div></div></div>
      <div style="text-align:right;">
        <div style="font-weight:700;">${sub.invoice_no || "INV-—"}</div>
        <div class="muted">Date: ${fdate(sub.created_at)}</div>
        <div class="badge" style="margin-top:6px;">PAID · ${method}</div>
      </div>
    </div>

    <div class="box">
      <div class="muted">Billed to</div>
      <div style="font-weight:700;font-size:16px;">${ownerName || "Owner"}</div>
      <div class="muted">${hostelName || sub.hostel_name || ""}</div>
    </div>

    <table>
      <tr><th>Description</th><th>Period</th><th style="text-align:right;">Amount</th></tr>
      <tr>
        <td><b>${sub.plan_name || "Plan"}</b><br/><span class="muted">${sub.months || 1} month(s) premium subscription</span></td>
        <td>${fdate(sub.start)}<br/><span class="muted">to ${fdate(sub.end)}</span></td>
        <td style="text-align:right;font-weight:700;">&#8377;${amt}</td>
      </tr>
    </table>

    <div class="total"><div style="text-align:right;"><div class="muted">Total Paid</div><div class="amt">&#8377;${amt}</div></div></div>

    <div class="footer">
      Thank you for choosing Hostel 360. This is a computer-generated invoice and does not require a signature.<br/>
      For support, contact your Hostel 360 administrator.
    </div>
  </body></html>`;
}

export async function downloadInvoice(sub: InvoiceData, ownerName: string, hostelName: string) {
  const html = buildHtml(sub, ownerName, hostelName);
  if (Platform.OS === "web") {
    const w = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => {
        try { w.print(); } catch {}
      }, 600);
      return { ok: true };
    }
    return { ok: false, error: "Popup blocked. Allow popups to download the invoice." };
  }
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Invoice", UTI: "com.adobe.pdf" });
  }
  return { ok: true, uri };
}

async function outputPdf(html: string, title: string) {
  if (Platform.OS === "web") {
    const w = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => { try { w.print(); } catch {} }, 600);
      return { ok: true };
    }
    return { ok: false, error: "Popup blocked. Allow popups to download." };
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: title, UTI: "com.adobe.pdf" });
  }
  return { ok: true, uri };
}

export interface ReceiptData {
  receipt_no?: string;
  date?: string;
  amount?: number;
  type?: string;
  method?: string;
  advance_amount?: number;
  security_deposit?: number;
  tenant_name?: string;
  room_number?: string;
  bed_number?: string;
  pg_name?: string;
  address?: string;
  contact?: string;
  owner_name?: string;
}

function monthYear(s?: string) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  } catch {
    return s;
  }
}

function buildReceiptHtml(r: ReceiptData) {
  const advRow = r.advance_amount
    ? `<tr><td>Advance Amount</td><td style="text-align:right;">&#8377;${r.advance_amount}</td></tr>`
    : "";
  const depRow = r.security_deposit
    ? `<tr><td>Security Deposit</td><td style="text-align:right;">&#8377;${r.security_deposit}</td></tr>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1A1D1A;padding:32px;background:#fff;}
    .head{text-align:center;border-bottom:3px solid #2C5E3E;padding-bottom:16px;}
    .pg{font-size:24px;font-weight:800;color:#2C5E3E;}
    .muted{color:#6A706A;font-size:13px;}
    .title{text-align:center;margin:22px 0 6px;font-size:16px;font-weight:800;letter-spacing:2px;color:#1A1D1A;}
    .meta{display:flex;justify-content:space-between;font-size:13px;color:#6A706A;margin-top:8px;}
    .line{margin-top:20px;font-size:15px;}
    .line b{color:#1A1D1A;}
    table{width:100%;border-collapse:collapse;margin-top:20px;}
    td{padding:12px 8px;border-bottom:1px solid #E5E7E5;font-size:14px;}
    .total td{border-top:2px solid #2C5E3E;border-bottom:none;font-size:18px;font-weight:800;color:#2C5E3E;padding-top:14px;}
    .sign{margin-top:60px;display:flex;justify-content:flex-end;}
    .sign .box{text-align:center;}
    .sign .name{font-family:'Segoe Script','Brush Script MT',cursive;font-size:22px;color:#2C5E3E;border-bottom:1px solid #1A1D1A;padding:0 24px 4px;}
    .sign .lbl{font-size:12px;color:#6A706A;margin-top:6px;}
    .badge{display:inline-block;background:#DCFCE7;color:#166534;font-size:12px;font-weight:700;padding:4px 12px;border-radius:999px;}
    .footer{margin-top:36px;border-top:1px solid #E5E7E5;padding-top:14px;font-size:12px;color:#6A706A;text-align:center;}
  </style></head><body>
    <div class="head">
      <div class="pg">${r.pg_name || "Hostel"}</div>
      <div class="muted">${r.address || ""}</div>
      <div class="muted">Contact: ${r.contact || "-"}</div>
    </div>
    <div class="title">RENT RECEIPT</div>
    <div style="text-align:center;"><span class="badge">PAID</span></div>
    <div class="meta"><span>Receipt No: <b>${r.receipt_no || "-"}</b></span><span>Date: ${fdate(r.date)}</span></div>

    <div class="line">Received with thanks from <b>${r.tenant_name || "Tenant"}</b>${r.room_number ? ` (Room ${r.room_number}${r.bed_number ? `, Bed ${r.bed_number}` : ""})` : ""}</div>
    <div class="line">For the month of <b>${monthYear(r.date)}</b> towards <b>${(r.type || "rent").toUpperCase()}</b>, paid via <b>${(r.method || "cash").toUpperCase()}</b>.</div>

    <table>
      <tr><td>${(r.type || "Rent")[0].toUpperCase()}${(r.type || "rent").slice(1)} Amount</td><td style="text-align:right;">&#8377;${r.amount ?? 0}</td></tr>
      ${advRow}
      ${depRow}
      <tr class="total"><td>Total Received</td><td style="text-align:right;">&#8377;${r.amount ?? 0}</td></tr>
    </table>

    <div class="sign">
      <div class="box">
        <div class="name">${r.owner_name || "Owner"}</div>
        <div class="lbl">For ${r.pg_name || "Hostel"} · Authorised Signatory</div>
      </div>
    </div>

    <div class="footer">This is a system-generated rent receipt from Hostel 360.</div>
  </body></html>`;
}

export async function downloadReceipt(r: ReceiptData) {
  const html = buildReceiptHtml(r);
  return outputPdf(html, "Rent Receipt");
}
