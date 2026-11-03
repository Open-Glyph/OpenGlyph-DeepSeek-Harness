"""Generate the distributable input-schema snapshot; never include credentials."""
import argparse
import json
from pathlib import Path


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--from-file',type=Path,required=True)
    args=parser.parse_args();value=json.loads(args.from_file.read_text())
    if value.get('protocol')!='guwenzi.tools.v1':raise ValueError('unexpected protocol')
    rows=value['tools']
    if not all(set(r)=={'name','description','input_schema'} for r in rows):raise ValueError('expected public tool schemas only')
    root=Path(__file__).resolve().parents[1]
    (root/'data').mkdir(exist_ok=True)
    result=dict(protocol=value['protocol'],source='guwenzi-tools 0.6.0 public schema snapshot',tools=rows)
    (root/'data/service-tools.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(tools=len(rows),credentials_included=False)))


if __name__=='__main__':main()
