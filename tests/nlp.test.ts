import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, detectLanguage, textSimilarity, type NlpContext } from '../src/lib/nlp/engine.ts';

const cat = (code: string, dept: string, pr = 'MEDIUM', ev = true) =>
  ({ code, name_en: code, name_ta: code, default_department: dept, evidence_required: ev, evidence_types: ['photo'], default_priority: pr as 'MEDIUM', keywords: [] });

const ctx: NlpContext = {
  categories: [
    cat('STREET_LIGHT', 'ELECTRICAL'), cat('WATER_SUPPLY', 'WATER', 'HIGH', false), cat('WATER_LEAK', 'WATER', 'HIGH'),
    cat('DRAINAGE', 'SANITATION', 'HIGH'), cat('ROAD_DAMAGE', 'ENGINEERING'), cat('GARBAGE', 'SANITATION'),
    cat('MOSQUITO', 'HEALTH', 'MEDIUM', false), cat('STRAY_ANIMALS', 'HEALTH', 'MEDIUM', false), cat('TREE_FALL', 'ENGINEERING', 'HIGH'),
    cat('PUBLIC_TOILET', 'SANITATION'), cat('ENCROACHMENT', 'TOWN_PLANNING', 'LOW'), cat('OTHER', 'GENERAL_ADMIN', 'MEDIUM', false),
  ],
  localBodies: [{ id: 1, name_en: 'Chennimalai', name_ta: 'சென்னிமலை' }],
  streets: [
    { id: 101, ward_id: 10, ward_number: 10, local_body_id: 1, name_en: 'Kothangadu 1st Street', name_ta: 'கொத்தங்காடு 1வது தெரு' },
    { id: 102, ward_id: 10, ward_number: 10, local_body_id: 1, name_en: 'Kothangadu 2nd Street', name_ta: 'கொத்தங்காடு 2வது தெரு' },
    { id: 103, ward_id: 10, ward_number: 10, local_body_id: 1, name_en: 'Kothangadu Main Road', name_ta: 'கொத்தங்காடு மெயின் ரோடு' },
    { id: 104, ward_id: 4, ward_number: 4, local_body_id: 1, name_en: 'Perundurai Road', name_ta: 'பெருந்துறை சாலை' },
    { id: 105, ward_id: 12, ward_number: 12, local_body_id: 1, name_en: 'Anna Nagar', name_ta: 'அண்ணா நகர்' },
  ],
};

const streetLightInputs = [
  'Enga street light rendu naala eriyala',
  'எங்க தெருவுல street light வேலை செய்யல',
  'Street light not working in my street',
  'Night time romba dark ah irukku, accident aagura chance irukku, light eriyala',
  'enga street light eriyala',
  'எங்க street light எரியல',
  'Street light work aagala',
  'எங்க தெருவுல ரெண்டு நாளா street light வேலை செய்யல',
  'streetlite eriyalai',
  'தெரு விளக்கு எரியவில்லை',
];

for (const input of streetLightInputs) {
  test(`street light: ${input}`, () => {
    assert.equal(analyze(input, ctx).category, 'STREET_LIGHT');
  });
}

test('full spoken Tanglish complaint from the brief', () => {
  const a = analyze(
    'Vanakkam, naan Navin. Chennimalai 10th ward Kothangadu 2nd street la irukken. Enga street light romba naala eriyala. Night time la romba dark ah irukku. Rendu per keela vizhundhirukanga.',
    ctx,
  );
  assert.equal(a.category, 'STREET_LIGHT');
  assert.equal(a.location.localBodyId, 1);
  assert.equal(a.location.wardNumber, 10);
  assert.equal(a.location.streetId, 102);
  assert.equal(a.safety.risk, true);
  assert.ok(a.duration && a.duration.days >= 7);
  assert.equal(a.severity, 'HIGH');
  assert.equal(a.language, 'tanglish');
  assert.match(a.confirm_en, /Street light not working in Kothangadu 2nd Street, Ward 10, Chennimalai/);
});

test('duration extraction: rendu naala → 2 days', () => {
  assert.equal(analyze('Enga street light rendu naala eriyala', ctx).duration?.days, 2);
  assert.equal(analyze('எங்க தெருவுல ரெண்டு நாளா street light வேலை செய்யல', ctx).duration?.days, 2);
});

test('Tamil ward & street', () => {
  const a = analyze('10வது வார்டு கொத்தங்காடு 2வது தெருவுல சாக்கடை அடைச்சு நாறுது', ctx);
  assert.equal(a.category, 'DRAINAGE');
  assert.equal(a.location.wardNumber, 10);
  assert.equal(a.location.streetId, 102);
});

const cases: Array<[string, string]> = [
  ['kuppai edukkala 1 vaaram aachu, romba naaruthu', 'GARBAGE'],
  ['குடிநீர் 3 நாளா வரல', 'WATER_SUPPLY'],
  ['thanni varala sir 4 days', 'WATER_SUPPLY'],
  ['pipe udainju thanni veena pogudhu', 'WATER_LEAK'],
  ['road la periya pallam irukku bike la vizhundhutaanga', 'ROAD_DAMAGE'],
  ['kosu thollai romba, dengue fever vandhuruchu', 'MOSQUITO'],
  ['theru naai kadichidhu en paiyana', 'STRAY_ANIMALS'],
  ['puyal la maram vizhundhu road block aagiduchu', 'TREE_FALL'],
  ['public toilet romba azhukka irukku water illa', 'PUBLIC_TOILET'],
  ['footpath la kadai aakramippu pannirukanga', 'ENCROACHMENT'],
  ['drainage overflow into houses, smell is unbearable', 'DRAINAGE'],
  ['Pothole on Perundurai Road near bus stand', 'ROAD_DAMAGE'],
  ['Garbage is not collected for a week', 'GARBAGE'],
];
for (const [input, expected] of cases) {
  test(`${expected}: ${input}`, () => assert.equal(analyze(input, ctx).category, expected));
}

test('electric hazard is CRITICAL', () => {
  assert.equal(analyze('street light pole la current wire arundhu kidakku, shock adikkuthu', ctx).severity, 'CRITICAL');
});

test('Main Road street name does not bias category to road', () => {
  const a = analyze('Kothangadu Main Road la street light eriyala', ctx);
  assert.equal(a.category, 'STREET_LIGHT');
  assert.equal(a.location.streetId, 103);
});

test('language detection', () => {
  assert.equal(detectLanguage('தெரு விளக்கு எரியவில்லை'), 'ta');
  assert.equal(detectLanguage('Street light not working'), 'en');
  assert.equal(detectLanguage('enga street light eriyala romba naala'), 'tanglish');
  assert.equal(detectLanguage('எங்க street light எரியல'), 'mixed');
});

test('similarity is high for same-issue phrasings', () => {
  assert.ok(textSimilarity('street light not working kothangadu', 'Kothangadu street light eriyala') > 0.3);
});

test('unknown gibberish falls back to OTHER with missing category', () => {
  const a = analyze('hello sir please help', ctx);
  assert.equal(a.category, 'OTHER');
  assert.ok(a.missing.includes('category'));
});
