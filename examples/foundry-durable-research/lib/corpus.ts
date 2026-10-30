// A small, explicitly fictional corpus makes the example quick to try.
// Replace this catalogue with your application's authenticated document service.
export const documents = [
  { id: "atlas", title: "Atlas vendor brief", text: "Atlas costs $40/user/month. EU hosting, SSO and audit logs are included. Support SLA: 4 hours." },
  { id: "birch", title: "Birch vendor brief", text: "Birch costs $25/user/month. US hosting only. SSO is an add-on. Support SLA: 1 business day." },
  { id: "cedar", title: "Cedar vendor brief", text: "Cedar costs $55/user/month. EU hosting and SSO are included. Support SLA: 1 hour. Audit-log retention: 2 years." },
] as const;
