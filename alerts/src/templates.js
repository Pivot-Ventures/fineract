"use strict";

/**
 * Seeded event types. WhatsApp template names must be created and
 * approved in the LipeChat portal before whatsappEnabled is turned on.
 * Placeholder order is the LipeChat body {{1}}, {{2}}, ... order.
 */
function defaultTemplates() {
  return [
    {
      type: "deposit",
      label: "Savings deposit",
      smsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      smsBody: "Phaneroo SACCO: {{currency}} {{amount}} deposited to account {{account}}. Ref {{reference}}.",
      whatsappTemplateName: "sacco_deposit",
      whatsappLanguageCode: "en",
      whatsappPlaceholders: ["currency", "amount", "account", "reference"],
      emailSubject: "Deposit received",
      emailBody: "Phaneroo SACCO: {{currency}} {{amount}} deposited to account {{account}}. Ref {{reference}}."
    },
    {
      type: "withdrawal",
      label: "Savings withdrawal",
      smsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      smsBody: "Phaneroo SACCO: {{currency}} {{amount}} withdrawn from account {{account}}. Ref {{reference}}.",
      whatsappTemplateName: "sacco_withdrawal",
      whatsappLanguageCode: "en",
      whatsappPlaceholders: ["currency", "amount", "account", "reference"],
      emailSubject: "Withdrawal posted",
      emailBody: "Phaneroo SACCO: {{currency}} {{amount}} withdrawn from account {{account}}. Ref {{reference}}."
    },
    {
      type: "loan_disburse",
      label: "Loan disbursement",
      smsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      smsBody: "Phaneroo SACCO: loan {{account}} disbursed {{currency}} {{amount}}. Ref {{reference}}.",
      whatsappTemplateName: "sacco_loan_disburse",
      whatsappLanguageCode: "en",
      whatsappPlaceholders: ["account", "currency", "amount", "reference"],
      emailSubject: "Loan disbursed",
      emailBody: "Phaneroo SACCO: loan {{account}} disbursed {{currency}} {{amount}}. Ref {{reference}}."
    },
    {
      type: "loan_repay",
      label: "Loan repayment",
      smsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      smsBody: "Phaneroo SACCO: {{currency}} {{amount}} received for loan {{account}}. Ref {{reference}}.",
      whatsappTemplateName: "sacco_loan_repay",
      whatsappLanguageCode: "en",
      whatsappPlaceholders: ["currency", "amount", "account", "reference"],
      emailSubject: "Loan repayment received",
      emailBody: "Phaneroo SACCO: {{currency}} {{amount}} received for loan {{account}}. Ref {{reference}}."
    },
    {
      type: "transfer",
      label: "Account transfer",
      smsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      smsBody: "Phaneroo SACCO: {{currency}} {{amount}} transferred from account {{account}}. Ref {{reference}}.",
      whatsappTemplateName: "sacco_transfer",
      whatsappLanguageCode: "en",
      whatsappPlaceholders: ["currency", "amount", "account", "reference"],
      emailSubject: "Transfer posted",
      emailBody: "Phaneroo SACCO: {{currency}} {{amount}} transferred from account {{account}}. Ref {{reference}}."
    },
    {
      type: "pin",
      label: "Mobile PIN lock cleared",
      smsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      smsBody: "Phaneroo SACCO: the mobile banking PIN lock for member {{memberId}} was cleared at your branch. If this was not you, contact the SACCO.",
      whatsappTemplateName: "sacco_pin",
      whatsappLanguageCode: "en",
      whatsappPlaceholders: ["memberId"],
      emailSubject: "Mobile PIN lock cleared",
      emailBody: "Phaneroo SACCO: the mobile banking PIN lock for member {{memberId}} was cleared at your branch."
    },
    {
      type: "activation",
      label: "Savings account activated",
      smsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      smsBody: "Phaneroo SACCO: savings account {{account}} is now active.",
      whatsappTemplateName: "sacco_activation",
      whatsappLanguageCode: "en",
      whatsappPlaceholders: ["account", "memberId"],
      emailSubject: "Account activated",
      emailBody: "Phaneroo SACCO: savings account {{account}} is now active."
    }
  ];
}

module.exports = { defaultTemplates };
