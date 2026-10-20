import json, pathlib
p=pathlib.Path('package.json')
j=json.loads(p.read_text(encoding='utf-8'))
j['scripts']['pack:all']="node -e \"const fs=require('fs');fs.mkdirSync('dist-pack',{recursive:true});fs.copyFileSync('transfer/final_v3.pdf','dist-pack/final_v3.pdf.tgz')\""
p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
