"""Local, JSON-only helpers; no model, account credential or remote tool request."""
import argparse
import contextlib
import json
from pathlib import Path,PurePosixPath
import shutil
import stat
import zipfile
import sys


def unpack(source,destination):
    destination=Path(destination).resolve()
    if destination.exists():raise ValueError('字体包目标目录已存在，不覆盖原文件')
    with zipfile.ZipFile(source) as archive:
        names=set()
        for item in archive.infolist():
            name=item.filename;path=PurePosixPath(name)
            if (path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or '\x00' in item.orig_filename or
                stat.S_ISLNK(item.external_attr>>16) or name in names or item.flag_bits&1):
                raise ValueError('字体包包含不安全、重复或加密的文件路径')
            names.add(name)
        if 'catalog.tex' not in names:raise ValueError('不是 LaTeX 字体包：缺少 catalog.tex')
        destination.mkdir(parents=True)
        for item in archive.infolist():
            target=destination/item.filename
            if item.is_dir():target.mkdir(parents=True,exist_ok=True);continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with archive.open(item) as source_file,target.open('xb') as output:
                shutil.copyfileobj(source_file,output,2**20)
    return {'directory':str(destination),'files':len(names)}


def audit(path):
    try:
        import pymupdf as fitz
    except ImportError:
        try:import fitz
        except ImportError:fitz=None
    if fitz is not None:
        with fitz.open(path) as pdf:
            fonts={}
            for page in pdf:
                for row in page.get_fonts(full=True):
                    xref,ext,kind,name=row[:4]
                    blob=pdf.extract_font(xref)[3] if xref else b''
                    fonts[name]={'name':name,'type':kind,'embedded':bool(blob),'bytes':len(blob)}
            return {'status':'checked','pages':len(pdf),'fonts':list(fonts.values()),
                'raster_image_occurrences':sum(len(page.get_images()) for page in pdf),
                'all_fonts_embedded':all(row['embedded'] for row in fonts.values())}
    try:
        from pypdf import PdfReader
    except ImportError:
        return {'status':'not_checked','reason':'可选 PDF 检查器未安装；调用 gwz_latex_setup(install_dependencies=true)。'}
    get=lambda value:value.get_object() if hasattr(value,'get_object') else value
    pdf=PdfReader(path);fonts={};images=0
    for page in pdf.pages:
        resources=get(page.get('/Resources',{}))
        for key,ref in get(resources.get('/Font',{})).items():
            font=ref.get_object();name=str(font.get('/BaseFont',key))
            descendants=get(font.get('/DescendantFonts'))
            leaf=descendants[0].get_object() if descendants else font
            descriptor=leaf.get('/FontDescriptor')
            descriptor=descriptor.get_object() if descriptor else {}
            embedded=any(key in descriptor for key in ('/FontFile','/FontFile2','/FontFile3'))
            fonts[name]={'name':name,'type':str(font.get('/Subtype','')),'embedded':embedded}
        for ref in get(resources.get('/XObject',{})).values():
            if ref.get_object().get('/Subtype')=='/Image':images+=1
    return {'status':'checked','pages':len(pdf.pages),'fonts':list(fonts.values()),
        'raster_image_occurrences':images,'all_fonts_embedded':all(row['embedded'] for row in fonts.values())}


def main():
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='action',required=True)
    u=sub.add_parser('unpack');u.add_argument('source');u.add_argument('destination')
    a=sub.add_parser('audit');a.add_argument('pdf')
    args=parser.parse_args()
    try:
        # Optional dependencies may print import/deprecation diagnostics. Keep
        # those in the complete stderr log, not ahead of our JSON response.
        with contextlib.redirect_stdout(sys.stderr):
            result=unpack(args.source,args.destination) if args.action=='unpack' else audit(args.pdf)
        print(json.dumps(result,ensure_ascii=False,allow_nan=False));return 0
    except Exception as exc:
        print(json.dumps({'error':type(exc).__name__,'message':str(exc)},ensure_ascii=False));return 1


if __name__=='__main__':raise SystemExit(main())
