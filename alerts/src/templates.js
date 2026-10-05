"use strict";

/**
 * Seeded event types. WhatsApp template names must be created and
 * approved in the LipeChat portal before whatsappEnabled is turned on.
 * Placeholder order is the LipeChat body {{1}}, {{2}}, ... order.
 *
 * Tokens are whitelisted per type (FIELDS). There is deliberately no
 * token for an activation code or a PIN: the service never receives one.
 * [[ ... ]] is an optional section, dropped when any token in it is empty.
 */
const MONEY_FIELDS = ["amount", "account", "balance", "reference", "date", "memberName", "branch"];
const NOTICE_FIELDS = ["memberName", "date", "branch"];

const FIELDS = {
  deposit: MONEY_FIELDS,
  withdrawal: MONEY_FIELDS,
  loan_disburse: MONEY_FIELDS,
  loan_repay: MONEY_FIELDS,
  transfer: MONEY_FIELDS,
  pin: NOTICE_FIELDS,
  activation: NOTICE_FIELDS,
  mobile_blocked: NOTICE_FIELDS
};

const TYPES = Object.keys(FIELDS);

/* Old seeded bodies that a store from an earlier release may still hold. */
const LEGACY_BODIES = {
  activation: "Phaneroo SACCO: savings account {{account}} is now active.",
  pin: "Phaneroo SACCO: the mobile banking PIN lock for member {{memberId}} was cleared at your branch. If this was not you, contact the SACCO."
};

function money(type, label, sms, wa) {
  return {
    type: type,
    label: label,
    smsEnabled: true,
    whatsappEnabled: false,
    smsBody: sms,
    whatsappTemplateName: wa,
    whatsappLanguageCode: "en",
    whatsappPlaceholders: ["amount", "account", "balance", "reference"]
  };
}

function notice(type, label, sms, wa) {
  return {
    type: type,
    label: label,
    smsEnabled: true,
    whatsappEnabled: false,
    smsBody: sms,
    whatsappTemplateName: wa,
    whatsappLanguageCode: "en",
    whatsappPlaceholders: ["branch"]
  };
}

function defaultTemplates() {
  return [
    money("deposit", "Savings deposit",
      "Phaneroo SACCO: {{amount}} deposited to account {{account}}[[ on {{date}}]].[[ Available balance {{balance}}.]][[ Ref {{reference}}.]]",
      "sacco_deposit"),
    money("withdrawal", "Savings withdrawal",
      "Phaneroo SACCO: {{amount}} withdrawn from account {{account}}[[ on {{date}}]].[[ Available balance {{balance}}.]][[ Ref {{reference}}.]]",
      "sacco_withdrawal"),
    money("loan_disburse", "Loan disbursement",
      "Phaneroo SACCO: loan {{account}} disbursed {{amount}}[[ on {{date}}]].[[ Loan balance {{balance}}.]][[ Ref {{reference}}.]]",
      "sacco_loan_disburse"),
    money("loan_repay", "Loan repayment",
      "Phaneroo SACCO: {{amount}} received for loan {{account}}[[ on {{date}}]].[[ Loan balance {{balance}}.]][[ Ref {{reference}}.]]",
      "sacco_loan_repay"),
    money("transfer", "Account transfer",
      "Phaneroo SACCO: {{amount}} transferred from account {{account}}[[ on {{date}}]].[[ Available balance {{balance}}.]][[ Ref {{reference}}.]]",
      "sacco_transfer"),
    notice("pin", "Mobile PIN reset or unlock",
      "Phaneroo SACCO: your mobile banking PIN was reset or unlocked. If this wasn't you, call {{branch}} now.",
      "sacco_pin"),
    notice("activation", "Mobile banking activated on a new phone",
      "Phaneroo SACCO: mobile banking was activated on a new phone. If this wasn't you, call {{branch}} now.",
      "sacco_activation"),
    notice("mobile_blocked", "Mobile banking blocked",
      "Phaneroo SACCO: mobile banking on your account has been blocked. If this wasn't you, call {{branch}} now.",
      "sacco_mobile_blocked")
  ];
}

module.exports = { defaultTemplates, FIELDS, TYPES, LEGACY_BODIES };
