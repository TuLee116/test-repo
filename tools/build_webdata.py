"""Turn extracted page JSON (dttt-package/data/pages) into compact data files for tmn-web.

python build_webdata.py <dttt-package/data/pages> <tmn-web/data>
"""
import json, os, re, sys, glob
sys.stdout.reconfigure(encoding='utf-8')
L = lambda q: chr(92) * 2 + '?' + chr(92) + os.path.abspath(q)
src, out = L(sys.argv[1]), L(sys.argv[2])
CUID = re.compile(r'^c[a-z0-9]{24}$')


def load(rel):
    f = os.path.join(src, rel.replace('/', os.sep))
    return json.load(open(f, encoding='utf-8')) if os.path.exists(f) else None


def props(page, pred):
    return [p['props'] for p in page['clientProps'] if pred(p['props'])] if page else []


def first(page, *keys):
    r = props(page, lambda p: all(k in p for k in keys))
    return r[0] if r else None


def save(name, obj):
    f = os.path.join(out, name.replace('/', os.sep))
    os.makedirs(os.path.dirname(f), exist_ok=True)
    json.dump(obj, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


def ids_in(folder):
    d = os.path.join(src, folder.replace('/', os.sep))
    return sorted({os.path.splitext(x)[0] for x in os.listdir(d) if CUID.match(os.path.splitext(x)[0])})


def doc_no(page, prefix):
    for p in page['clientProps']:
        m = re.search(prefix + r'\d{2}-\d{4}', json.dumps(p['props'], ensure_ascii=False))
        if m:
            return m.group(0)
    return ''


# ---- layout / overview
proj = load('projects.json')
save('sidebar.json', first(proj, 'groups', 'slots'))
save('stats.json', first(proj, 'stats')['stats'])

# ---- users
pq = first(load('gia-doi/phan-quyen.json'), 'roles', 'users')
save('users.json', {'roles': pq['roles'], 'users': pq['users']})

# ---- catalog
save('catalog.json', first(load('catalog.json'), 'rows')['rows'])

# ---- contracts (hop-dong)
contracts = []
for cid in ids_in('gia-doi/hop-dong'):
    page = load(f'gia-doi/hop-dong/{cid}.json')
    info = first(page, 'init', 'versions') or {}
    lines = {}
    order = []
    for c in props(page, lambda p: p.get('contractId') == cid and 'lineKey' in p and 'field' in p):
        k = c['lineKey']
        if k not in lines:
            lines[k] = {'key': k, 'prices': {}}
            order.append(k)
        if c['field'] == 'price':
            lines[k]['prices'][str(c.get('ver', 1))] = c.get('value')
        else:
            lines[k][c['field']] = c.get('value')
    rec = {'id': cid, **(info.get('init') or {}), 'source': info.get('source'),
           'versions': info.get('versions', []), 'lines': [lines[k] for k in order]}
    save(f'contracts/{cid}.json', rec)
    contracts.append({k: rec.get(k) for k in ('id', 'area', 'name', 'packageName', 'contractNo', 'appendixNo', 'appendixOfId', 'source', 'approvedVersion')}
                     | {'lineCount': len(order), 'versionCount': len(rec['versions'])})
save('contracts.json', contracts)


# ---- ho so gia doi
def total_of(lines, field):
    return sum((l.get(field) or 0) for l in lines if l.get('level') not in ('GROUP', 'SUB'))


gd = []
for gid in ids_in('gia-doi'):
    page = load(f'gia-doi/{gid}.json')
    d = first(page, 'head', 'lines', 'status')
    if not d:
        continue
    keep = {k: d.get(k) for k in ('id', 'kind', 'status', 'head', 'lines', 'contractId', 'revision', 'notes', 'total')}
    keep['no'] = doc_no(page, 'GD')
    save(f'gia-doi/{gid}.json', keep)
    lines = d.get('lines') or []
    gd.append({'id': gid, 'no': keep['no'], 'kind': d.get('kind'), 'status': d.get('status'), 'revision': d.get('revision'),
               'contractId': d.get('contractId'), **{k: d['head'].get(k) for k in ('projectName', 'contractNo', 'itemName', 'batch', 'batchDate', 'category')},
               'lineCount': len(lines), 'siteAmount': total_of(lines, 'siteAmount'), 'apprAmount': total_of(lines, 'apprAmount')})
save('gia-doi.json', gd)

# ---- trinh gia thau phu
tp = []
for tid in ids_in('gia-doi/thau-phu'):
    page = load(f'gia-doi/thau-phu/{tid}.json')
    d = first(page, 'head', 'lines', 'bidders')
    if not d:
        continue
    keep = {k: d.get(k) for k in ('id', 'head', 'lines', 'bidders', 'category', 'branch', 'branchReason', 'revision', 'notes', 'reviewNote')}
    keep['no'] = doc_no(page, 'TP')
    hd = first(page, 'hdNo', 'hdAt')
    keep['hd'] = hd and {'no': hd['hdNo'], 'at': hd['hdAt']}
    save(f'thau-phu/{tid}.json', keep)
    h = d['head']
    tp.append({'id': tid, 'no': keep['no'], 'area': h.get('area'), 'branch': d.get('branch'), 'category': d.get('category'),
               'projectName': h.get('projectName'), 'itemName': h.get('itemName'), 'subName': h.get('subName'),
               'cdtContract': h.get('cdtContract'), 'proposalType': h.get('proposalType'), 'revision': d.get('revision'),
               'lineCount': len(d.get('lines') or []), 'hdNo': keep['hd'] and keep['hd']['no']})
save('thau-phu.json', tp)

# ---- DT-CP per project
pj = []
for pid in ids_in('projects'):
    page = load(f'projects/{pid}.json')
    sheet = first(page, 'rows', 'totalA')
    st = first(page, 'status', 'logs')
    rec = {'id': pid, 'rows': sheet and [{k: r.get(k) for k in ('id', 'parentId', 'section', 'depth', 'code', 'name', 'unit', 'amount', 'note', 'isLeaf')} for r in sheet['rows']],
           'totalA': sheet and sheet['totalA'], 'totalB': sheet and sheet['totalB'], 'vatRate': sheet and sheet.get('vatRate'),
           'status': st and {k: st.get(k) for k in ('status', 'submitted', 'approved', 'contractNo', 'qsttName', 'logs')}}
    boq = load(f'projects/{pid}/boq.json')
    items = first(boq, 'existingItems')
    rec['boq'] = items['existingItems'] if items else []
    save(f'projects/{pid}.json', rec)
    pj.append(pid)
print('contracts', len(contracts), 'gia-doi', len(gd), 'thau-phu', len(tp), 'projects', len(pj))
