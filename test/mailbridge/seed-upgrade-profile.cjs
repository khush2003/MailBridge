const fs = require('node:fs'), path = require('node:path');
const profile=path.join(process.env.APPDATA,'MailBridge');
fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({'*':{
  core:{ keymapTemplate:'Outlook', reading:{markAsReadDelay:-1}, workspace:{mode:'split'}, disabledPackages:['mcp-server','open-tracking','link-tracking','activity','thread-sharing'] },
  env:'production',containerFolderDefault:'',accountsVersion:19,
  identity:{id:'old-upstream-identity',emailAddress:'test@example.test',stripePlan:'Basic',stripePlanEffective:'Basic'},
  accounts:[{id:'c0ffee-peer',metadata:[],name:'Upgrade account',provider:'imap',emailAddress:'test@example.test',label:'test@example.test',settings:{imap_host:'127.0.0.1',imap_port:65530,imap_username:'test',imap_security:'none',smtp_host:'127.0.0.1',smtp_port:65530,smtp_username:'test',smtp_security:'none'},autoaddress:{type:'bcc',value:''},aliases:[],authedAt:0,syncState:'sync_error',__cls:'Account'}]
}}));
fs.writeFileSync(path.join(profile,'mailbridge','settings.json'),JSON.stringify({backupEnabled:true,backupInterval:'weekly',backupFolder:'D:\\Backups',lastBackup:{completedAt:Date.now(),count:1}}));
