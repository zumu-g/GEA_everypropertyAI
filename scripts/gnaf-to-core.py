#!/usr/bin/env python3
"""Join full G-NAF PSV (VIC) into a flat core-style CSV for import-gnaf.mjs,
filtered to Casey/Cardinia postcodes. Reads directly from the release zip."""

import csv
import io
import sys
import zipfile

ZIP = sys.argv[1]
OUT = sys.argv[2]
POSTCODES = {
    '3800', '3802', '3803', '3804', '3805', '3806', '3807', '3808', '3809',
    '3810', '3811', '3812', '3813', '3814', '3815', '3816',
    '3977', '3978', '3979', '3980',
}

zf = zipfile.ZipFile(ZIP)
names = {n.rsplit('/', 1)[-1]: n for n in zf.namelist() if n.endswith('.psv')}

def rows(member):
    with zf.open(names[member]) as f:
        reader = csv.reader(io.TextIOWrapper(f, encoding='utf-8'), delimiter='|')
        header = [h.strip().upper() for h in next(reader)]
        for r in reader:
            yield dict(zip(header, r))

print('street localities…')
streets = {}
for r in rows('VIC_STREET_LOCALITY_psv.psv'):
    streets[r['STREET_LOCALITY_PID']] = (r['STREET_NAME'], r.get('STREET_TYPE_CODE', ''))

print('localities…')
locs = {r['LOCALITY_PID']: r['LOCALITY_NAME'] for r in rows('VIC_LOCALITY_psv.psv')}

print('address details (filtering postcodes)…')
details = {}
for r in rows('VIC_ADDRESS_DETAIL_psv.psv'):
    if r.get('POSTCODE') not in POSTCODES or r.get('DATE_RETIRED'):
        continue
    num = r.get('NUMBER_FIRST', '')
    if not num:
        continue  # lot-only addresses aren't useful for suggest
    if r.get('NUMBER_FIRST_SUFFIX'):
        num += r['NUMBER_FIRST_SUFFIX']
    if r.get('NUMBER_LAST'):
        num = f"{num}-{r['NUMBER_LAST']}{r.get('NUMBER_LAST_SUFFIX','')}"
    flat = r.get('FLAT_NUMBER', '')
    if flat:
        num = f"{flat}/{num}"
    street_name, street_type = streets.get(r['STREET_LOCALITY_PID'], ('', ''))
    details[r['ADDRESS_DETAIL_PID']] = {
        'number_first': num,
        'street_name': street_name,
        'street_type': street_type,
        'locality_name': locs.get(r['LOCALITY_PID'], ''),
        'state': 'VIC',
        'postcode': r['POSTCODE'],
    }
print(f'  {len(details)} in-area addresses')

print('geocodes…')
geo = {}
for r in rows('VIC_ADDRESS_DEFAULT_GEOCODE_psv.psv'):
    pid = r['ADDRESS_DETAIL_PID']
    if pid in details:
        geo[pid] = (r.get('LATITUDE', ''), r.get('LONGITUDE', ''))

with open(OUT, 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['number_first', 'street_name', 'street_type', 'locality_name',
                'state', 'postcode', 'latitude', 'longitude', 'address_label'])
    for pid, d in details.items():
        lat, lng = geo.get(pid, ('', ''))
        street = ' '.join(x for x in [d['street_name'], d['street_type']] if x)
        label = f"{d['number_first']} {street}, {d['locality_name']} VIC {d['postcode']}"
        w.writerow([d['number_first'], d['street_name'], d['street_type'],
                    d['locality_name'], d['state'], d['postcode'], lat, lng, label])

print(f'wrote {OUT}: {len(details)} rows')
