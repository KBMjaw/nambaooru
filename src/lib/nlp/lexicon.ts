/**
 * Tamil / Tanglish / English civic-issue lexicon.
 *
 * Terms are matched against normalised text:
 *  - Tamil-script terms match as substrings (Tamil is agglutinative:
 *    "தெருவுல" contains "தெரு", "எரியலை" contains "எரியல").
 *  - Latin terms match whole tokens with small spelling tolerance, or as a
 *    token prefix for Tanglish suffixes ("streetla", "lightu", "roadla").
 *  - Multi-word terms match as phrases.
 * Admins can extend keywords per category from the database (complaint_categories.keywords).
 */

export type CategoryCode =
  | 'STREET_LIGHT' | 'WATER_SUPPLY' | 'WATER_LEAK' | 'DRAINAGE' | 'ROAD_DAMAGE' | 'GARBAGE'
  | 'MOSQUITO' | 'STRAY_ANIMALS' | 'TREE_FALL' | 'PUBLIC_TOILET' | 'ENCROACHMENT' | 'OTHER';

export interface CategoryLexicon {
  strong: string[]; // weight 3
  weak: string[];   // weight 1
}

export const LEXICON: Record<Exclude<CategoryCode, 'OTHER'>, CategoryLexicon> = {
  STREET_LIGHT: {
    strong: [
      'street light', 'streetlight', 'street lights', 'street lamp', 'street bulb', 'lamp post', 'light post', 'light pole',
      'theru vilakku', 'theruvilakku', 'vilakku', 'vilaku', 'velakku', 'tube light', 'sodium light', 'led light', 'high mast',
      'தெரு விளக்கு', 'தெருவிளக்கு', 'விளக்கு', 'விளக்குகள்', 'லைட் போஸ்ட்', 'ஸ்ட்ரீட் லைட்', 'ஸ்ட்ரீட்லைட்', 'மின்விளக்கு', 'டியூப் லைட்',
    ],
    weak: [
      'light', 'lights', 'lite', 'bulb', 'lamp', 'eriyala', 'eriyalai', 'eriyavillai', 'eriyale', 'eriyathu', 'eriyadhu', 'eriyuthilla',
      'minnuthu', 'blinking', 'flickering', 'dark', 'darkness', 'iruttu', 'irutu', 'iruttah', 'iruttaa', 'night', 'raathiri', 'rathiri', 'nightla',
      'லைட்', 'பல்பு', 'எரியல', 'எரியலை', 'எரியவில்லை', 'எரியாது', 'எரியுது', 'இருட்டு', 'இருட்டா', 'இரவு', 'ராத்திரி', 'இருள்',
    ],
  },
  WATER_SUPPLY: {
    strong: [
      'drinking water', 'water supply', 'water not coming', 'no water', 'water not supplied', 'kudineer', 'kudi neer', 'kudinir',
      'thanni varala', 'thanni varalai', 'tanni varala', 'thanni vara', 'thanneer varala', 'water varala', 'water varalai', 'overhead tank',
      'water problem', 'water shortage', 'dirty water', 'muddy water', 'kalangal thanni', 'kalangalana',
      'குடிநீர்', 'குடி நீர்', 'தண்ணீர் வரல', 'தண்ணி வரல', 'தண்ணீர் வரவில்லை', 'தண்ணி வரவில்லை', 'தண்ணி வரலை', 'கலங்கலான', 'நீர்த்தேக்கத் தொட்டி',
    ],
    weak: [
      'water', 'thanni', 'tanni', 'thannir', 'thanneer', 'neer', 'varala', 'varalai', 'varavillai', 'pressure', 'tank', 'tap', 'motor', 'supply',
      'தண்ணி', 'தண்ணீர்', 'நீர்', 'வரல', 'வரலை', 'வரவில்லை', 'தொட்டி', 'குழாய்', 'பைப்',
    ],
  },
  WATER_LEAK: {
    strong: [
      'pipe leak', 'pipeline leak', 'pipe broken', 'pipe burst', 'pipe damage', 'pipe udainju', 'pipe udanjiruku', 'pipe udaippu', 'leakage',
      'water leak', 'water leaking', 'thanni veena pogudhu', 'thanni veenaa', 'water wastage', 'water wasting', 'ozhugudhu', 'kasivu',
      'குழாய் உடைப்பு', 'குழாய் உடைந்து', 'பைப் உடைஞ்சு', 'உடைப்பு', 'கசிவு', 'ஒழுகுது', 'வீணாக', 'வீணா போகுது', 'லீக்',
    ],
    weak: ['pipe', 'pipeline', 'leak', 'leaking', 'burst', 'udainju', 'udanju', 'veena', 'குழாய்', 'பைப்', 'உடைஞ்சு', 'உடைந்த', 'வீணா'],
  },
  DRAINAGE: {
    strong: [
      'drainage', 'drain', 'sewage', 'sewer', 'gutter', 'manhole', 'underground drainage', 'ugd', 'kazhivu neer', 'kalivu neer', 'kazhivuneer',
      'sakkadai', 'saakadai', 'sakadai', 'saakkadai', 'vaaikaal', 'vaikkal', 'kaalvaai', 'kalvai', 'stagnant water', 'water stagnation', 'thengi nikkuthu',
      'கழிவுநீர்', 'கழிவு நீர்', 'சாக்கடை', 'வடிகால்', 'வாய்க்கால்', 'கால்வாய்', 'மேன்ஹோல்', 'பாதாள சாக்கடை', 'டிரைனேஜ்', 'தேங்கி',
    ],
    weak: [
      'block', 'blocked', 'blockage', 'adaippu', 'adaichirukku', 'adaichu', 'overflow', 'overflowing', 'smell', 'stink', 'naatram', 'naaruthu', 'naarudhu',
      'rain water', 'mazhai thanni', 'mazhai neer', 'flood', 'vellam', 'thengi',
      'அடைப்பு', 'அடைச்சு', 'அடைத்து', 'நாற்றம்', 'நாறுது', 'துர்நாற்றம்', 'மழைநீர்', 'மழை தண்ணி', 'வெள்ளம்', 'வழிந்து',
    ],
  },
  ROAD_DAMAGE: {
    strong: [
      'pothole', 'potholes', 'pot hole', 'road damage', 'road damaged', 'damaged road', 'broken road', 'road broken', 'bad road', 'road repair',
      'road podala', 'road podalai', 'road sariyilla', 'road mosam', 'road romba mosam', 'pallam', 'palam', 'kuzhi', 'kuli', 'road kuzhi',
      'பள்ளம்', 'குழி', 'சாலை சேதம்', 'ரோடு சேதம்', 'ரோடு சரியில்ல', 'ரோடு மோசம்', 'சாலை பழுது', 'ரோடு போடல', 'குண்டும் குழியுமா', 'குண்டும் குழியும்',
    ],
    weak: [
      'road', 'roads', 'rodu', 'salai', 'tar', 'thaar', 'jalli', 'mud', 'sethu', 'speed breaker', 'bike', 'vandi', 'slip',
      'சாலை', 'ரோடு', 'தார்', 'ஜல்லி', 'சேறு', 'வண்டி', 'வேகத்தடை',
    ],
  },
  GARBAGE: {
    strong: [
      'garbage', 'kuppai', 'kupai', 'trash', 'rubbish', 'dustbin', 'garbage bin', 'waste', 'solid waste', 'garbage not collected', 'kuppai edukkala',
      'kuppai vandi', 'kuppai vandi varala', 'dumping', 'garbage dump', 'garbage burning', 'kuppai erikiraanga', 'plastic waste',
      'குப்பை', 'குப்பைகள்', 'குப்பைத் தொட்டி', 'குப்பை வண்டி', 'கழிவுகள்', 'குப்பை எடுக்கல', 'குப்பை கொட்டுறாங்க',
    ],
    weak: ['dirty', 'azhukku', 'clean', 'cleaning', 'sutham', 'edukkala', 'plastic', 'smell', 'naatram', 'அழுக்கு', 'சுத்தம்', 'எடுக்கல', 'பிளாஸ்டிக்', 'நாற்றம்'],
  },
  MOSQUITO: {
    strong: [
      'mosquito', 'mosquitoes', 'mosquitos', 'kosu', 'kosugal', 'kosu thollai', 'dengue', 'malaria', 'fogging', 'pugai marundhu', 'kosu marundhu',
      'கொசு', 'கொசுக்கள்', 'கொசுத் தொல்லை', 'டெங்கு', 'மலேரியா', 'புகை மருந்து', 'கொசு மருந்து',
    ],
    weak: ['fever', 'kaichal', 'kaaichal', 'stagnant', 'காய்ச்சல்', 'ஜுரம்'],
  },
  STRAY_ANIMALS: {
    strong: [
      'stray dog', 'stray dogs', 'street dog', 'street dogs', 'dog bite', 'dogs', 'naai', 'nai', 'theru naai', 'naaigal', 'cattle', 'cows', 'maadu',
      'pig', 'pigs', 'pandri', 'monkey', 'monkeys', 'kurangu', 'snake', 'paambu', 'pambu',
      'நாய்', 'நாய்கள்', 'தெருநாய்', 'தெரு நாய்', 'நாய்க்கடி', 'மாடு', 'மாடுகள்', 'பன்றி', 'பன்றிகள்', 'குரங்கு', 'பாம்பு',
    ],
    weak: ['dog', 'bite', 'kadi', 'kadichidhu', 'kadikkuthu', 'chasing', 'thorathuthu', 'cow', 'கடி', 'கடிச்சது', 'கடிக்குது', 'துரத்துது'],
  },
  TREE_FALL: {
    strong: [
      'tree fell', 'tree fallen', 'fallen tree', 'tree fall', 'tree collapsed', 'maram vizhundhu', 'maram vilunthu', 'maram vizhunthirukku', 'kilai',
      'branch fell', 'tree branch', 'tree cutting', 'maram', 'மரம் விழுந்து', 'மரம் சாய்ந்து', 'மரக்கிளை', 'கிளை', 'மரம்',
    ],
    weak: ['tree', 'trees', 'branch', 'branches', 'storm', 'puyal', 'wind', 'kaathu', 'புயல்', 'காற்று', 'சாய்ந்து'],
  },
  PUBLIC_TOILET: {
    strong: [
      'public toilet', 'toilet', 'toilets', 'restroom', 'urinal', 'bathroom', 'kazhipparai', 'kalipparai', 'kazhippidam', 'comfort station',
      'கழிப்பறை', 'கழிப்பிடம்', 'பொதுக் கழிப்பறை', 'சிறுநீர் கழிப்பிடம்', 'டாய்லெட்',
    ],
    weak: ['dirty', 'smell', 'water illa', 'lock', 'அழுக்கு', 'நாற்றம்', 'பூட்டி'],
  },
  ENCROACHMENT: {
    strong: [
      'encroachment', 'encroached', 'illegal construction', 'footpath blocked', 'footpath occupied', 'aakramippu', 'akramippu', 'aakiramippu',
      'ஆக்கிரமிப்பு', 'ஆக்கிரமிச்சு', 'சட்டவிரோத கட்டிடம்', 'நடைபாதை ஆக்கிரமிப்பு',
    ],
    weak: ['illegal', 'footpath', 'platform', 'occupied', 'shop', 'kadai', 'nadaipathai', 'நடைபாதை', 'கடை'],
  },
};

/** Safety / urgency cues → (weight, english label, tamil label). */
export const SAFETY_CUES: Array<{ terms: string[]; weight: number; en: string; ta: string; critical?: boolean }> = [
  { terms: ['accident', 'accidents', 'vibathu', 'vibaththu', 'விபத்து', 'ஆக்சிடென்ட்'], weight: 3, en: 'accident risk', ta: 'விபத்து அபாயம்' },
  { terms: ['fell', 'fallen down', 'fell down', 'keela vizhundhu', 'keezha vizhundhu', 'keela vizhundhirukanga', 'vizhundhirukanga', 'vizhundhaanga', 'vilunthanga', 'vizhunthutaanga', 'விழுந்துட்டாங்க', 'விழுந்தாங்க', 'கீழே விழுந்து', 'கீழ விழுந்து', 'விழுந்திருக்காங்க'], weight: 3, en: 'people have fallen', ta: 'மக்கள் கீழே விழுந்துள்ளனர்' },
  { terms: ['injury', 'injured', 'hurt', 'adi pattu', 'adipattu', 'kaayam', 'அடிபட்டு', 'காயம்', 'hospital', 'aaspathiri', 'மருத்துவமனை'], weight: 3, en: 'injury reported', ta: 'காயம் ஏற்பட்டுள்ளது' },
  { terms: ['danger', 'dangerous', 'aabathu', 'abaayam', 'aabathaana', 'ஆபத்து', 'அபாயம்', 'ஆபத்தான'], weight: 2, en: 'dangerous condition', ta: 'ஆபத்தான நிலை' },
  { terms: ['electric shock', 'current shock', 'shock', 'live wire', 'wire cut', 'wire arundhu', 'current wire', 'மின்சாரம் தாக்கி', 'ஷாக்', 'கம்பி அறுந்து', 'மின் கம்பி'], weight: 4, en: 'electrical hazard', ta: 'மின் அபாயம்', critical: true },
  { terms: ['children', 'kids', 'kuzhandhaigal', 'kulanthaigal', 'pasanga', 'school', 'பள்ளி', 'குழந்தைகள்', 'பசங்க', 'மாணவர்கள்'], weight: 1, en: 'children affected', ta: 'குழந்தைகள் பாதிப்பு' },
  { terms: ['old people', 'elderly', 'senior citizen', 'vayasanavanga', 'periyavanga', 'வயசானவங்க', 'முதியவர்கள்'], weight: 1, en: 'elderly affected', ta: 'முதியோர் பாதிப்பு' },
  { terms: ['women', 'ladies', 'pombala', 'pengal', 'பெண்கள்', 'பொம்பள'], weight: 1, en: 'women’s safety', ta: 'பெண்கள் பாதுகாப்பு' },
  { terms: ['theft', 'thief', 'thirudan', 'thiruttu', 'chain snatching', 'திருட்டு', 'திருடன்'], weight: 2, en: 'theft / crime risk', ta: 'திருட்டு அபாயம்' },
  { terms: ['dog bite', 'bit a', 'kadichidhu', 'kadichiruchu', 'நாய்க்கடி', 'கடிச்சது', 'கடித்தது'], weight: 4, en: 'animal bite', ta: 'விலங்குக் கடி', critical: true },
  { terms: ['snake', 'paambu', 'pambu', 'பாம்பு'], weight: 2, en: 'snake risk', ta: 'பாம்பு அபாயம்' },
  { terms: ['dengue', 'டெங்கு', 'malaria', 'மலேரியா', 'fever', 'kaichal', 'காய்ச்சல்'], weight: 2, en: 'disease risk', ta: 'நோய் பரவும் அபாயம்' },
  { terms: ['into houses', 'veetukulla', 'veettukulla', 'வீட்டுக்குள்ள', 'வீட்டுக்குள்'], weight: 2, en: 'entering homes', ta: 'வீடுகளுக்குள் புகுகிறது' },
  { terms: ['blocking road', 'road block', 'traffic', 'vazhi illa', 'வழி இல்ல', 'போக்குவரத்து'], weight: 1, en: 'road blocked', ta: 'வழி அடைப்பு' },
  { terms: ['dark', 'iruttu', 'irutu', 'இருட்டு', 'இருட்டா', 'இருள்'], weight: 1, en: 'unsafe darkness at night', ta: 'இரவில் இருட்டு' },
];

/** Tamil & Tanglish number words (cardinal and ordinal stems). */
export const NUMBER_WORDS: Record<string, number> = {
  one: 1, first: 1, onnu: 1, ondru: 1, oru: 1, 'ஒன்று': 1, 'ஒண்ணு': 1, 'ஒரு': 1, 'முதல்': 1,
  two: 2, second: 2, rendu: 2, randu: 2, irandu: 2, 'இரண்டு': 2, 'ரெண்டு': 2, 'இரண்டாவது': 2, 'ரெண்டாவது': 2,
  three: 3, third: 3, moonu: 3, munu: 3, moondru: 3, 'மூன்று': 3, 'மூணு': 3, 'மூன்றாவது': 3,
  four: 4, fourth: 4, naalu: 4, nalu: 4, 'நான்கு': 4, 'நாலு': 4, 'நான்காவது': 4, 'நாலாவது': 4,
  five: 5, fifth: 5, anju: 5, ainthu: 5, 'ஐந்து': 5, 'அஞ்சு': 5, 'ஐந்தாவது': 5, 'அஞ்சாவது': 5,
  six: 6, sixth: 6, aaru: 6, 'ஆறு': 6, 'ஆறாவது': 6,
  seven: 7, seventh: 7, ezhu: 7, elu: 7, 'ஏழு': 7, 'ஏழாவது': 7,
  eight: 8, eighth: 8, ettu: 8, 'எட்டு': 8, 'எட்டாவது': 8,
  nine: 9, ninth: 9, onbadhu: 9, onbathu: 9, 'ஒன்பது': 9, 'ஒன்பதாவது': 9,
  ten: 10, tenth: 10, pathu: 10, pattu: 10, pathavadhu: 10, pathaavathu: 10, 'பத்து': 10, 'பத்தாவது': 10,
  eleven: 11, pathinonnu: 11, 'பதினொன்று': 11, 'பதினொண்ணு': 11, 'பதினொன்றாவது': 11,
  twelve: 12, panirendu: 12, pannendu: 12, 'பன்னிரண்டு': 12, 'பன்னெண்டு': 12,
  thirteen: 13, pathimoonu: 13, 'பதிமூன்று': 13, 'பதிமூணு': 13,
  fourteen: 14, pathinaalu: 14, 'பதினான்கு': 14, 'பதினாலு': 14,
  fifteen: 15, pathinanju: 15, 'பதினைந்து': 15, 'பதினஞ்சு': 15,
  sixteen: 16, pathinaaru: 16, 'பதினாறு': 16,
  seventeen: 17, pathinezhu: 17, 'பதினேழு': 17,
  eighteen: 18, pathinettu: 18, 'பதினெட்டு': 18,
  nineteen: 19, 'பத்தொன்பது': 19,
  twenty: 20, irupathu: 20, 'இருபது': 20,
};

/** Romanised-Tamil function words used to detect Tanglish input. */
export const TANGLISH_MARKERS = [
  'enga', 'engal', 'romba', 'rombha', 'illa', 'illai', 'irukku', 'iruku', 'irukken', 'irukkom', 'naala', 'naal', 'la', 'le', 'lae', 'theru', 'therula',
  'varala', 'eriyala', 'pannunga', 'panunga', 'sir', 'anna', 'akka', 'aagala', 'aaguthu', 'aagura', 'aachu', 'vanakkam', 'naan', 'nanga', 'namma',
  'intha', 'indha', 'antha', 'andha', 'kitta', 'pakkam', 'pakathula', 'veedu', 'veetu', 'udane', 'seekiram', 'please', 'konjam', 'ellam', 'yaarum',
  'vizhundhu', 'vizhundhirukanga', 'keela', 'kuppai', 'thanni', 'sakkadai', 'pallam', 'kosu', 'naai', 'maram', 'edukkala', 'podala', 'mosam', 'chance',
];

/** Generic street-type words (used when extracting street names). */
export const STREET_TYPES_EN = ['street', 'st', 'road', 'rd', 'salai', 'theru', 'veedhi', 'veethi', 'nagar', 'colony', 'layout', 'lane', 'cross', 'extension', 'avenue', 'main road', 'bazaar', 'bazar'];
export const STREET_TYPES_TA = ['தெரு', 'வீதி', 'சாலை', 'நகர்', 'காலனி', 'ரோடு', 'லேஅவுட்', 'சந்து', 'பஜார்'];

export const STOPWORDS = new Set([
  'enga', 'engal', 'our', 'my', 'the', 'a', 'an', 'in', 'at', 'on', 'near', 'la', 'le', 'lae', 'is', 'are', 'was', 'naan', 'i', 'am', 'we',
  'irukken', 'irukkom', 'iruku', 'irukku', 'vanakkam', 'hello', 'sir', 'madam', 'please', 'this', 'that', 'intha', 'indha', 'antha', 'andha',
  'from', 'of', 'and', 'to', 'for', 'with', 'there', 'here', 'no', 'number', 'ward', 'in', 'area', 'pakkam', 'kitta', 'veetu', 'veedu', 'house',
]);
