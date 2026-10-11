window.C = {
  PRODUCTS: [
    ['laminate','强化复合地板','Laminate Flooring'],
    ['engineered','实木复合地板','Engineered Wood Flooring'],
    ['spc','SPC石塑地板','SPC Flooring'],
    ['uv_panel','UV装饰板','UV Wall Panel'],
    ['pvc_fluted','PVC长城板/条形墙板','PVC Fluted / Slat Wall Panel'],
    ['pvc_grille','PVC格栅','PVC Grille'],
    ['coex_panel','共挤墙板','Co-extrusion Wall Panel'],
    ['wpc_panel','WPC墙板/外墙挂板','WPC Wall Panel / Cladding'],
    ['pvc_marble','PVC仿大理石板','PVC Marble Panel'],
    ['acoustic','吸音板','Acoustic Panel'],
    ['wpc_decking','WPC户外地板','WPC Decking']
  ],
  TYPES: [
    ['importer','进口商','Importer'],['distributor','分销商','Distributor'],
    ['wholesaler','建材批发商','Building-material Wholesaler'],['brand','品牌商','Brand Owner'],['other','其他','Other']
  ],
  STATUSES: [['未联系','Not contacted'],['已联系','Contacted'],['已回复','Replied'],['已报价','Quoted'],['成交','Won'],['无效','Invalid']],
  PRIORITIES: ['A+','A','B','C'],
  CHANNELS: [['email','邮件 Email'],['phone','电话 Call'],['whatsapp','WhatsApp'],['linkedin','LinkedIn'],['wechat','微信 WeChat'],['meeting','见面/展会 Meeting'],['other','其他 Other']],
  SAMPLE_STATUS: [['待寄','To send'],['已寄出','Sent'],['已签收','Delivered'],['已反馈','Feedback received']],
  INCOTERMS: ['FOB','CIF','CFR','EXW','DDP','DAP'],
  UNITS: ['m²','pc','m','box','sqft'],
  US_EXCLUDED: ['laminate','engineered'],
  MOQ: '300 m²',
  // initial client info that salespeople may correct but not erase
  PROTECTED: ['company_name','country','website','company_phone','company_email','address'],
  FIELDS: [
    ['company_name','公司名称','Company Name'],['customer_type','客户类型','Customer Type'],['country','国家','Country'],
    ['state','州/地区','State/Region'],['city','城市','City'],['address','地址','Address'],['company_phone','公司电话','Company Phone'],
    ['whatsapp','WhatsApp','WhatsApp'],['company_email','公司邮箱','Company Email'],['website','网站','Website'],
    ['contact_name','采购联系人','Purchasing Contact'],['contact_title','职位','Title'],['contact_linkedin','LinkedIn','LinkedIn'],
    ['products','匹配产品','Matching Products'],['apollo_criteria','Apollo搜索条件','Apollo Search Criteria'],['priority','优先级','Priority'],
    ['owner','负责业务员','Owner'],['status','跟进状态','Follow-up Status'],['next_follow_up','下次跟进','Next Follow-up'],['tags','标签','Tags'],
    ['notes','备注','Notes'],['source_note','来源/核实说明','Source / Verification']
  ]
};
C.productName = k => { const p = C.PRODUCTS.find(x => x[0] === k); return p ? p[1] : k; };
C.productEN = k => { const p = C.PRODUCTS.find(x => x[0] === k); return p ? p[2] : k; };
C.typeName = k => { const p = C.TYPES.find(x => x[0] === k); return p ? p[1] + ' ' + p[2] : (k || ''); };
C.typeCN = k => { const p = C.TYPES.find(x => x[0] === k); return p ? p[1] : (k || ''); };
C.statusEN = k => { const p = C.STATUSES.find(x => x[0] === k); return p ? p[1] : ''; };
C.channelName = k => { const p = C.CHANNELS.find(x => x[0] === k); return p ? p[1] : (k || ''); };

// ---- Time zones (country default + per-state overrides) ----
C.TZ = {
  'USA': 'America/New_York', 'Canada': 'America/Toronto', 'United Kingdom': 'Europe/London', 'Australia': 'Australia/Sydney',
  'Germany': 'Europe/Berlin', 'France': 'Europe/Paris', 'Italy': 'Europe/Rome', 'Netherlands': 'Europe/Amsterdam', 'Poland': 'Europe/Warsaw',
  'Belgium': 'Europe/Brussels', 'Switzerland': 'Europe/Zurich', 'Austria': 'Europe/Vienna', 'Czechia': 'Europe/Prague', 'Romania': 'Europe/Bucharest',
  'Spain': 'Europe/Madrid', 'Sweden': 'Europe/Stockholm', 'Türkiye': 'Europe/Istanbul', 'India': 'Asia/Kolkata', 'Japan': 'Asia/Tokyo', 'Norway': 'Europe/Oslo',
  'New Zealand': 'Pacific/Auckland', 'Ireland': 'Europe/Dublin', 'Mexico': 'America/Mexico_City', 'United Arab Emirates': 'Asia/Dubai', 'Saudi Arabia': 'Asia/Riyadh',
  'South Africa': 'Africa/Johannesburg', 'Brazil': 'America/Sao_Paulo', 'Chile': 'America/Santiago', 'Israel': 'Asia/Jerusalem', 'Denmark': 'Europe/Copenhagen', 'Finland': 'Europe/Helsinki'
};
C.STATE_TZ = {
  USA: { CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', NV: 'America/Los_Angeles', AZ: 'America/Phoenix', UT: 'America/Denver', CO: 'America/Denver', NM: 'America/Denver', ID: 'America/Boise', MT: 'America/Denver', WY: 'America/Denver',
    TX: 'America/Chicago', IL: 'America/Chicago', MN: 'America/Chicago', WI: 'America/Chicago', MO: 'America/Chicago', IA: 'America/Chicago', KS: 'America/Chicago', NE: 'America/Chicago', OK: 'America/Chicago', AR: 'America/Chicago', LA: 'America/Chicago', MS: 'America/Chicago', AL: 'America/Chicago', TN: 'America/Chicago', ND: 'America/Chicago', SD: 'America/Chicago', HI: 'Pacific/Honolulu', AK: 'America/Anchorage' },
  Canada: { BC: 'America/Vancouver', AB: 'America/Edmonton', SK: 'America/Regina', MB: 'America/Winnipeg', ON: 'America/Toronto', QC: 'America/Toronto', NS: 'America/Halifax', NB: 'America/Moncton', NL: 'America/St_Johns', PE: 'America/Halifax' },
  Australia: { WA: 'Australia/Perth', SA: 'Australia/Adelaide', NT: 'Australia/Darwin', QLD: 'Australia/Brisbane', VIC: 'Australia/Melbourne', NSW: 'Australia/Sydney', TAS: 'Australia/Hobart', ACT: 'Australia/Sydney' }
};
C.tzFor = c => ((C.STATE_TZ[c.country] || {})[(c.state || '').toUpperCase()]) || C.TZ[c.country] || null;
C.DIAL = { USA: '1', Canada: '1', 'United Kingdom': '44', Australia: '61', Germany: '49', France: '33', Italy: '39', Netherlands: '31', Poland: '48', Belgium: '32', Switzerland: '41', Austria: '43', Czechia: '420', Romania: '40', Spain: '34', Sweden: '46', 'Türkiye': '90', India: '91', Japan: '81', Norway: '47', 'New Zealand': '64', Ireland: '353', Mexico: '52' };

// ---- Prospecting keywords (local language) ----
C.LANG = { Germany: 'de', Austria: 'de', Switzerland: 'de', France: 'fr', Belgium: 'fr', Netherlands: 'nl', Poland: 'pl', Italy: 'it', Spain: 'es', Czechia: 'cs', Romania: 'ro', Sweden: 'sv', Norway: 'no', 'Türkiye': 'tr', Japan: 'ja' };
C.KW = {
  spc: { en: ['SPC flooring', 'rigid core vinyl flooring', 'luxury vinyl plank'], de: ['SPC Boden', 'Vinylboden'], fr: ['sol SPC', 'sol vinyle rigide'], nl: ['SPC vloer', 'PVC vloer'], pl: ['podłogi SPC', 'panele winylowe'], it: ['pavimento SPC', 'pavimenti vinilici'], es: ['suelo SPC', 'suelo vinílico'], cs: ['SPC podlahy', 'vinylové podlahy'], ro: ['parchet SPC', 'pardoseli vinil'], sv: ['SPC golv', 'vinylgolv'], no: ['SPC gulv', 'vinylgulv'], tr: ['SPC parke'], ja: ['SPC 床材'] },
  laminate: { en: ['laminate flooring'], de: ['Laminat'], fr: ['parquet stratifié'], nl: ['laminaat'], pl: ['panele laminowane'], it: ['pavimenti in laminato'], es: ['suelo laminado'], cs: ['laminátové podlahy'], ro: ['parchet laminat'], sv: ['laminatgolv'], no: ['laminatgulv'], tr: ['laminat parke'], ja: ['フローリング'] },
  engineered: { en: ['engineered wood flooring'], de: ['Mehrschichtparkett'], fr: ['parquet contrecollé'], nl: ['multiplank'], pl: ['deska warstwowa'], it: ['parquet prefinito'], es: ['tarima multicapa'], cs: ['dřevěné podlahy vícevrstvé'], ro: ['parchet triplustratificat'], sv: ['parkettgolv'], no: ['parkett'], tr: ['lamine parke'], ja: ['複合フローリング'] },
  wall: { en: ['PVC wall panels', 'fluted wall panels', 'UV marble sheet'], de: ['Wandpaneele', 'Wandverkleidung PVC'], fr: ['panneaux muraux PVC', 'lambris PVC'], nl: ['wandpanelen', 'PVC wandpanelen'], pl: ['panele ścienne', 'lamele ścienne'], it: ['pannelli murali', 'rivestimento pareti PVC'], es: ['paneles de pared', 'revestimiento PVC'], cs: ['stěnové panely'], ro: ['panouri decorative perete'], sv: ['väggpaneler'], no: ['veggpanel'], tr: ['duvar paneli'], ja: ['壁パネル'] },
  acoustic: { en: ['acoustic slat wall panels'], de: ['Akustikpaneele'], fr: ['panneaux acoustiques'], nl: ['akoestische panelen'], pl: ['panele akustyczne'], it: ['pannelli fonoassorbenti'], es: ['paneles acústicos'], cs: ['akustické panely'], ro: ['panouri acustice'], sv: ['akustikpaneler'], no: ['akustikkpanel'], tr: ['akustik panel'], ja: ['吸音パネル'] },
  wpc: { en: ['composite decking', 'WPC cladding'], de: ['WPC Terrassendielen', 'WPC Fassade'], fr: ['lame de terrasse composite', 'bardage composite'], nl: ['composiet vlonderplanken', 'composiet gevelbekleding'], pl: ['deska tarasowa kompozytowa'], it: ['decking WPC', 'pavimento esterno composito'], es: ['tarima composite', 'revestimiento WPC'], cs: ['WPC terasy'], ro: ['deck WPC'], sv: ['komposittrall'], no: ['kompositt terrassebord'], tr: ['WPC deck'], ja: ['人工木デッキ'] }
};
C.KW_GROUPS = [['spc', 'SPC 地板'], ['laminate', '强化地板'], ['engineered', '实木复合'], ['wall', '墙板 (UV/PVC/共挤/大理石)'], ['acoustic', '吸音板'], ['wpc', 'WPC 户外地板/挂板']];
C.TYPE_KW = { en: ['importer', 'distributor', 'wholesale'], de: ['Importeur', 'Großhandel', 'Fachgroßhandel'], fr: ['importateur', 'distributeur', 'grossiste'], nl: ['importeur', 'groothandel'], pl: ['importer', 'hurtownia', 'dystrybutor'], it: ['importatore', 'distributore', 'ingrosso'], es: ['importador', 'distribuidor', 'mayorista'], cs: ['dovozce', 'velkoobchod'], ro: ['importator', 'distribuitor', 'en-gros'], sv: ['importör', 'grossist'], no: ['importør', 'grossist'], tr: ['ithalatçı', 'toptan'], ja: ['輸入商社', '卸売'] };
C.DIRECTORIES = { // site: searches for trade directories per country
  _all: ['europages.com', 'kompass.com'], USA: ['importyeti.com', 'thomasnet.com', 'nafcd.org'], Canada: ['yellowpages.ca', 'nafcd.org'], 'United Kingdom': ['yell.com', 'contractflooringjournal.co.uk'], Australia: ['yellowpages.com.au'],
  Germany: ['wlw.de', 'gelbeseiten.de'], France: ['pagesjaunes.fr', 'societe.com'], Netherlands: ['detelefoongids.nl'], Poland: ['panoramafirm.pl'], Italy: ['paginegialle.it'], Spain: ['paginasamarillas.es']
};
