using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using MimeKit;
using MsgKit;

class Program {
    static void Report(object value) { Console.WriteLine(JsonConvert.SerializeObject(value)); Console.Out.Flush(); }
    static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); }
    static string Hash(string file) { using (var input=File.OpenRead(file)) using (var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant(); }
    static string SafeFolder(string name) { return string.IsNullOrWhiteSpace(name) ? "Imported" : name.Substring(0, Math.Min(name.Length, 120)); }
    static List<JObject> Records(string root) {
        return Directory.EnumerateFiles(Path.Combine(root,"records"),"*.json")
            .Where(file => System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(file),"^[a-f0-9]{64}-[a-f0-9]{64}\\.json$"))
            .OrderBy(file=>File.GetLastWriteTimeUtc(file)).Select(file=>JObject.Parse(File.ReadAllText(file)))
            .GroupBy(record=>(string)record["key"]).Select(group=>group.Last()).ToList();
    }
    static void Convert(string eml, string msg) { Converter.ConvertEmlToMsg(eml,msg); }
    static void SelfTest() {
        var directory=Path.Combine(Path.GetTempPath(),"mailbridge-msg-"+Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        try {
            var source=Path.Combine(directory,"source.eml"); var msg=Path.Combine(directory,"mail.msg"); var recovered=Path.Combine(directory,"restored.eml");
            var message=new MimeMessage(); message.From.Add(new MailboxAddress("Séndér","sender@example.test"));
            message.To.Add(new MailboxAddress("Recipient","to@example.test")); message.Cc.Add(new MailboxAddress("Copy","cc@example.test"));
            message.Bcc.Add(new MailboxAddress("Hidden","bcc@example.test")); message.Subject="PST backup — café";
            message.MessageId="backup-fixture@example.test"; message.Date=new DateTimeOffset(2010,1,2,3,4,5,TimeSpan.Zero);
            var body=new BodyBuilder { TextBody="Complete plaintext", HtmlBody="<p>Complete HTML</p><img src=\"cid:inline@example.test\">" };
            body.Attachments.Add("report.bin",new byte[]{0,1,2,255});
            var inline=body.LinkedResources.Add("image.png",new byte[]{3,4,5}); inline.ContentId="inline@example.test";
            message.Body=body.ToMessageBody(); message.WriteTo(source); Convert(source,msg); Converter.ConvertMsgToEml(msg,recovered);
            var result=MimeMessage.Load(recovered);
            if(result.Subject!=message.Subject || result.MessageId!=message.MessageId || result.Date.Year!=2010 ||
               result.To.Mailboxes.Single().Address!="to@example.test" || result.Cc.Mailboxes.Single().Address!="cc@example.test" ||
               result.Bcc.Mailboxes.Single().Address!="bcc@example.test" || !result.HtmlBody.Contains("Complete HTML")) throw new Exception("MSG envelope, dates or body did not round trip");
            foreach(var expected in new[]{new{ Name="report.bin", Data=new byte[]{0,1,2,255}},new{ Name="image.png", Data=new byte[]{3,4,5}}}) {
                var part=result.BodyParts.OfType<MimePart>().Single(p=>p.FileName==expected.Name);
                using(var stream=new MemoryStream()){part.Content.DecodeTo(stream);if(!stream.ToArray().SequenceEqual(expected.Data))throw new Exception("Attachment bytes changed");}
            }
            if(!result.BodyParts.Any(p=>p.ContentId=="inline@example.test")) throw new Exception("Inline content ID was lost");
            Report(new { selfTest="passed", checks="Unicode headers, original date, Message-ID, To/Cc/Bcc, HTML, attachment bytes and inline CID" });
        } finally { Directory.Delete(directory,true); }
    }
    [STAThread]
    static int Main(string[] args) {
        Console.OutputEncoding=new UTF8Encoding(false);
        try {
            if(args.Length==1 && args[0]=="--self-test"){SelfTest();return 0;}
            if(args.Length!=2) throw new Exception("Expected local archive and staging backup directory");
            Export(Path.GetFullPath(args[0]),Path.GetFullPath(args[1])); return 0;
        } catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
    static void Export(string root,string output) {
        Directory.CreateDirectory(output);
        var records=Records(root); if(records.Count==0) throw new Exception("No retained messages are available to back up.");
        var type=Type.GetTypeFromProgID("Outlook.Application");
        if(type==null) throw new Exception("PST backups require classic Outlook installed on this PC.");
        object application=null, session=null, store=null, storeRoot=null;
        var files=new List<string>(); int count=0; int part=0;
        try {
            Report(new {message="Opening classic Outlook for PST backup. Complete any Outlook profile prompts.",count,total=records.Count});
            application=Activator.CreateInstance(type); session=((dynamic)application).GetNamespace("MAPI");
            Action openPart=()=>{
                if(storeRoot!=null){((dynamic)session).RemoveStore(storeRoot);Release(storeRoot);Release(store);storeRoot=null;store=null;}
                part++;var file=Path.Combine(output,part==1?"MailBridge.pst":"MailBridge-part"+part+".pst");
                if(File.Exists(file))throw new Exception("Backup staging file already exists");
                ((dynamic)session).AddStoreEx(file,3);
                dynamic stores=((dynamic)session).Stores;
                try{for(int i=1;i<=stores.Count;i++){object candidate=stores.Item(i);if(string.Equals((string)((dynamic)candidate).FilePath,file,StringComparison.OrdinalIgnoreCase)){store=candidate;break;}Release(candidate);}}
                finally{Release(stores);}
                if(store==null)throw new Exception("Outlook could not create the backup PST");
                storeRoot=((dynamic)store).GetRootFolder();files.Add(file);
            };
            openPart();
            foreach(var record in records){
                if(File.Exists(Path.Combine(output,"cancel-request")))throw new Exception("Backup canceled; previous completed backups are unchanged");
                var key=(string)record["key"];var digest=(string)record["digest"];
                if(!System.Text.RegularExpressions.Regex.IsMatch(key??"","^[a-f0-9]{64}$") || !System.Text.RegularExpressions.Regex.IsMatch(digest??"","^[a-f0-9]{64}$"))throw new Exception("Invalid retained message identity");
                var source=Path.Combine(root,"blobs",digest+".eml");
                if(Hash(source)!=digest)throw new Exception("A retained message failed its checksum; previous backups are preserved");
                var stateFile=Path.Combine(root,"state",key+".json");
                var state=File.Exists(stateFile)?JObject.Parse(File.ReadAllText(stateFile)):record;
                var folder=(bool?)state["hidden"]==true?(string)state["hiddenFolder"]??"Trash":(string)state["folder"]??(string)record["folder"]??"Imported";
                var msg=Path.Combine(output,"message.msg"); object target=null, item=null, moved=null;
                try {
                    Convert(source,msg);
                    target=storeRoot;
                    foreach(var name in new[]{(string)record["email"]??"Mail"}.Concat(folder.Split('/'))){
                        object folders=((dynamic)target).Folders;object next=null;
                        try{try{next=((dynamic)folders).Item(SafeFolder(name));}catch{next=((dynamic)folders).Add(SafeFolder(name),6);}}
                        finally{Release(folders);}
                        if(!ReferenceEquals(target,storeRoot))Release(target);target=next;
                    }
                    item=((dynamic)session).OpenSharedItem(msg); moved=((dynamic)item).Move(target);
                    ((dynamic)moved).UnRead=(bool?)state["unread"]??(bool?)record["unread"]??false;
                    ((dynamic)moved).FlagStatus=((bool?)state["starred"]??(bool?)record["starred"]??false)?2:0;
                    ((dynamic)moved).Save();count++;
                } finally {if(!ReferenceEquals(moved,item))Release(moved);Release(item);if(!ReferenceEquals(target,storeRoot))Release(target);if(File.Exists(msg))File.Delete(msg);}
                Report(new {message="Backing up retained mail",count,total=records.Count});
                // Keep every part comfortably below Outlook's default Unicode PST limit.
                if(new FileInfo(files.Last()).Length>=20L*1024*1024*1024 && count<records.Count)openPart();
            }
            ((dynamic)session).RemoveStore(storeRoot); Release(storeRoot);Release(store);storeRoot=null;store=null;
            foreach(var file in files){using(var input=File.OpenRead(file)){var signature=new byte[4];input.Read(signature,0,4);if(!signature.SequenceEqual(new byte[]{0x21,0x42,0x44,0x4e}))throw new Exception("Outlook did not produce a valid PST signature");}}
            Report(new {complete=true,count,total=records.Count,files=files.Select(Path.GetFileName).ToArray()});
        } finally {
            if(storeRoot!=null){try{((dynamic)session).RemoveStore(storeRoot);}catch{}Release(storeRoot);}
            Release(store);Release(session);Release(application);
        }
    }
}
