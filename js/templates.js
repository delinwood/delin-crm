// Default outreach templates (English). Merge fields: {{company}} {{contact_first}} {{country}} {{products}} {{moq}}
// {{my_name}} {{my_title}} {{my_company}} {{my_email}} {{my_whatsapp}} {{my_website}}
window.DEFAULT_TEMPLATES = [
 { id: 't_e1', channel: 'email', stage: 'first', name: '首封开发信 First touch (email)', subject: '{{products}} supplier for {{company}} – factory direct, MOQ {{moq}}',
   body: `Hi {{contact_first}},

I'm {{my_name}}, {{my_title}} at {{my_company}}, a China-based manufacturer and exporter of {{products}}.

We work with importers and distributors in {{country}} and I noticed {{company}} supplies the trade there, so I thought a direct factory source could be useful for your range:

• Factory-direct pricing, FOB / CIF quotes within 24 hours
• Low MOQ: {{moq}} per item, mixed container welcome
• Custom colours, sizes, packaging and private label
• Free samples (you only cover courier, refundable on first order)

Would you be open to receiving our catalogue and a price list? If you tell me which products move best for you, I'll send matching samples.

Best regards,
{{my_name}}
{{my_title}} | {{my_company}}
Email: {{my_email}} | WhatsApp: {{my_whatsapp}}
{{my_website}}` },
 { id: 't_e2', channel: 'email', stage: 'follow1', name: '跟进1（3-5天后）Follow-up #1', subject: 'Re: {{products}} supplier for {{company}}',
   body: `Hi {{contact_first}},

Just following up on my note last week. I've attached our latest catalogue for {{products}}.

Many of our {{country}} customers start with a trial order of {{moq}} so they can test quality and lead time before committing to a full container.

Is there a colour or spec you're currently sourcing? I'm happy to quote it.

Best regards,
{{my_name}} | {{my_company}}
WhatsApp: {{my_whatsapp}}` },
 { id: 't_e3', channel: 'email', stage: 'follow2', name: '跟进2（10-14天后）Follow-up #2 – value', subject: 'New collections + free samples for {{company}}',
   body: `Hi {{contact_first}},

Sharing a quick update: we've just launched new designs in {{products}}, and we can ship free samples to {{country}} this month.

If {{company}} is reviewing suppliers for next season, could you point me to the right person in purchasing? I'd really appreciate it.

Thanks,
{{my_name}} | {{my_company}}` },
 { id: 't_e4', channel: 'email', stage: 'after_quote', name: '报价后跟进 After quotation', subject: 'Your quotation – {{products}} – any questions?',
   body: `Hi {{contact_first}},

Hope you had a chance to review our quotation. A few notes that may help:
• Prices are valid for 30 days; MOQ {{moq}} per item
• Lead time is typically 20–25 days after deposit
• We can adjust packaging / labels for {{company}}

Is there anything I can clarify, or a target price you'd like us to work towards?

Best regards,
{{my_name}} | {{my_company}}` },
 { id: 't_e5', channel: 'email', stage: 'after_sample', name: '样品后跟进 After samples', subject: 'Samples for {{company}} – your feedback?',
   body: `Hi {{contact_first}},

Our tracking shows the samples have arrived. How did the {{products}} look and feel to your team?

If quality fits, we can prepare a trial order from {{moq}} and send a proforma invoice the same day.

Best regards,
{{my_name}} | {{my_company}}` },
 { id: 't_l1', channel: 'linkedin', stage: 'first', name: 'LinkedIn 加好友附言 Connect note', subject: '',
   body: `Hi {{contact_first}}, I'm {{my_name}} from {{my_company}}, a manufacturer of {{products}} working with importers in {{country}}. Would be glad to connect and share our latest collections (MOQ {{moq}}).` },
 { id: 't_l2', channel: 'linkedin', stage: 'follow1', name: 'LinkedIn 通过后消息 After connect', subject: '',
   body: `Thanks for connecting, {{contact_first}}! In case it's useful for {{company}}: we supply {{products}} factory-direct, with private label and a low MOQ of {{moq}}. Happy to send our catalogue or free samples — what's the best email for you?` },
 { id: 't_w1', channel: 'whatsapp', stage: 'first', name: 'WhatsApp 首次联系 First touch', subject: '',
   body: `Hello {{contact_first}}, this is {{my_name}} from {{my_company}} (China). We manufacture {{products}} for importers in {{country}}. MOQ only {{moq}}, free samples available. May I send you our catalogue here?` },
 { id: 't_w2', channel: 'whatsapp', stage: 'follow1', name: 'WhatsApp 跟进 Follow-up', subject: '',
   body: `Hi {{contact_first}}, {{my_name}} from {{my_company}} again 🙂 Did you get a chance to look at our {{products}} catalogue? I can quote any spec you need (MOQ {{moq}}).` }
];
C.STAGES = [['first', '首次 First touch'], ['follow1', '跟进1 Follow-up 1'], ['follow2', '跟进2 Follow-up 2'], ['after_quote', '报价后 After quote'], ['after_sample', '样品后 After sample']];
C.TPL_CHANNELS = [['email', '邮件 Email'], ['linkedin', 'LinkedIn'], ['whatsapp', 'WhatsApp']];
