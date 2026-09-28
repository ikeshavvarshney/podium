import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type Delivery = "email" | "log";

let transport: Transporter | null | undefined;

function smtp(): Transporter | null {
  if (transport === undefined) {
    transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  }
  return transport;
}

/**
 * Sends through SMTP when SMTP_URL is set. Without it the platform stays offline and writes the
 * message to the API log, for the operator to relay; the caller learns which happened.
 */
export async function sendMail(mail: Mail): Promise<Delivery> {
  const transporter = smtp();
  if (!transporter) {
    console.log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return "log";
  }
  await transporter.sendMail({ from: config.MAIL_FROM, ...mail });
  return "email";
}

export const mailDelivery = (): Delivery => (config.SMTP_URL ? "email" : "log");
