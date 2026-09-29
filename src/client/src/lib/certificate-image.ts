import { jpegToPdf } from "@/lib/pdf";

export interface CertificateView {
  title: string;
  holder: string;
  org: string | null;
  award: string | null;
  sentence: string;
  issued: string;
  code: string;
}

export interface CertificateFonts {
  display: string;
  body: string;
  mono: string;
}

const WIDTH = 2000;
const PAD_TOP = 190;
const PAD_BOTTOM = 150;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function breakAnywhere(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws just the certificate card, sized to its content, so the PNG and the PDF match what the page shows. */
export async function drawCertificate(view: CertificateView, fonts: CertificateFonts): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const cx = WIDTH / 2;

  type Op = { y: number; font: string; color: string; text: string; spacing?: string };
  const ops: Op[] = [];
  const text = (y: number, font: string, color: string, value: string, spacing?: string) =>
    ops.push({ y, font, color, text: value, spacing });

  let y = 0;
  text(y, `500 36px ${fonts.mono}`, "#1c1c22", view.title.toUpperCase(), "5px");
  y += 150;
  text(y, `400 42px ${fonts.body}`, "#6b6b76", "This certifies that");
  y += 140;
  text(y, `500 96px ${fonts.display}`, "#0b0b0e", view.holder);
  if (view.org) {
    y += 90;
    text(y, `400 40px ${fonts.body}`, "#6b6b76", view.org);
  }
  if (view.award) {
    y += 110;
    text(y, `600 54px ${fonts.display}`, "#3b5bdb", view.award);
  }
  y += 150;
  ctx.font = `400 46px ${fonts.body}`;
  for (const line of wrap(ctx, view.sentence, 1500)) {
    text(y, `400 46px ${fonts.body}`, "#0b0b0e", line);
    y += 72;
  }
  y += 150;
  text(y, `400 35px ${fonts.mono}`, "#6b6b76", view.issued);
  y += 110;
  ctx.font = `400 31px ${fonts.mono}`;
  const codeLines = breakAnywhere(ctx, view.code, 1260);
  codeLines.forEach((line, i) => text(y + i * 52, `400 31px ${fonts.mono}`, "#6b6b76", line));
  y += (codeLines.length - 1) * 52;

  canvas.width = WIDTH;
  canvas.height = PAD_TOP + y + PAD_BOTTOM;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#e3e3e8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 44);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const op of ops) {
    ctx.font = op.font;
    ctx.fillStyle = op.color;
    ctx.letterSpacing = op.spacing ?? "0px";
    ctx.fillText(op.text, cx, PAD_TOP + op.y);
  }
  ctx.letterSpacing = "0px";
  return canvas;
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadCertificatePng(view: CertificateView, fonts: CertificateFonts, filename: string) {
  const canvas = await drawCertificate(view, fonts);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob) save(blob, filename);
}

export async function downloadCertificatePdf(view: CertificateView, fonts: CertificateFonts, filename: string) {
  const canvas = await drawCertificate(view, fonts);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
  if (!blob) return;
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  const pageWidth = 842;
  save(jpegToPdf(jpeg, canvas.width, canvas.height, pageWidth, Math.round((pageWidth * canvas.height) / canvas.width)), filename);
}
