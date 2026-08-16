/**
 * The bodies, groupings and agreements that keep appearing in coverage.
 *
 * A headline says "the SCO summit" and assumes you know what that is. Readers
 * following world news for an examination are tested on exactly that gap, and
 * it is a gap this site was well placed to fill and did not: the archive knows
 * which stories mention the SCO, and had nothing to say about what it is.
 *
 * Deliberately static rather than generated. These are settled reference
 * facts, and a model paraphrasing them would introduce errors into the one
 * kind of content where an error is memorised rather than skimmed.
 *
 * `India` names India's own standing where there is a specific fact worth
 * knowing — membership is the single most commonly examined detail about any
 * of these, and the answer is often "not a member", which is harder to look up
 * than it sounds.
 *
 * Memberships and mandates do change. Every entry links onward, and the page
 * says plainly that it is a summary rather than a source.
 */

export const CATEGORIES = {
    grouping: 'Groupings & forums',
    institution: 'International institutions',
    regime: 'Treaties & control regimes',
    corridor: 'Corridors & connectivity',
    doctrine: 'India’s stated policies',
};

// `match` is the list of forms that appear in a headline. Kept explicit rather
// than derived from the name: "Quad" needs a word boundary or it fires on
// "quadrant", and expansions are written out because outlets vary.
export const TERMS = [
    {
        id: 'unsc',
        name: 'UN Security Council',
        category: 'institution',
        match: ['UN Security Council', 'UNSC', 'Security Council'],
        what: 'The UN organ responsible for international peace and security, and the only one whose decisions bind all member states. Five permanent members hold a veto; ten non-permanent members serve two-year terms.',
        india: 'Not a permanent member. Has served several non-permanent terms and seeks a permanent seat through the G4 with Brazil, Germany and Japan.',
    },
    {
        id: 'unga',
        name: 'UN General Assembly',
        category: 'institution',
        match: ['UN General Assembly', 'UNGA', 'General Assembly'],
        what: 'The UN body where all member states sit with one vote each. Its resolutions carry political weight but, unlike the Security Council’s, are not binding.',
        india: 'Founding member of the United Nations.',
    },
    {
        id: 'icj',
        name: 'International Court of Justice',
        category: 'institution',
        match: ['International Court of Justice', 'ICJ', 'World Court'],
        what: 'The UN’s principal judicial organ. Settles disputes between states and gives advisory opinions. Sits at The Hague. Distinct from the ICC — the ICJ tries states, not individuals.',
        india: 'Accepts its jurisdiction with reservations.',
    },
    {
        id: 'icc',
        name: 'International Criminal Court',
        category: 'institution',
        match: ['International Criminal Court', 'ICC'],
        what: 'Tries individuals for genocide, crimes against humanity, war crimes and aggression. Established by the Rome Statute; independent of the UN.',
        india: 'Not a party to the Rome Statute.',
    },
    {
        id: 'iaea',
        name: 'IAEA',
        category: 'institution',
        match: ['IAEA', 'International Atomic Energy Agency', 'atomic energy agency'],
        what: 'Promotes peaceful nuclear use and verifies, through safeguards and inspections, that nuclear material is not diverted to weapons.',
        india: 'A member, with safeguards applying to its civilian reactors only.',
    },
    {
        id: 'who',
        name: 'World Health Organization',
        category: 'institution',
        match: ['World Health Organization', 'World Health Organisation', 'WHO'],
        what: 'The UN’s health agency. Coordinates international health responses and declares Public Health Emergencies of International Concern.',
        india: 'A member; sits in its South-East Asia region.',
    },
    {
        id: 'imf',
        name: 'IMF',
        category: 'institution',
        match: ['IMF', 'International Monetary Fund'],
        what: 'Lends to countries in balance-of-payments difficulty, usually with conditions attached, and monitors the world economy. Voting power follows quotas, which track economic size.',
        india: 'A member; among the larger quota holders.',
    },
    {
        id: 'world-bank',
        name: 'World Bank',
        category: 'institution',
        match: ['World Bank', 'IBRD', 'International Development Association'],
        what: 'Lends for development and infrastructure. A group of five bodies, of which the IBRD and IDA are the lending arms.',
        india: 'A member and historically one of the largest borrowers.',
    },
    {
        id: 'wto',
        name: 'WTO',
        category: 'institution',
        match: ['WTO', 'World Trade Organization', 'World Trade Organisation'],
        what: 'Administers trade rules and settles trade disputes. Decisions are taken by consensus, which is why its negotiating rounds stall.',
        india: 'A founding member, from 1995.',
    },
    {
        id: 'fatf',
        name: 'FATF',
        category: 'institution',
        match: ['FATF', 'Financial Action Task Force'],
        what: 'Sets standards against money laundering and terrorist financing. Its "grey list" and "black list" carry real financial consequences for the countries named.',
        india: 'A member.',
    },
    {
        id: 'oecd',
        name: 'OECD',
        category: 'institution',
        match: ['OECD', 'Organisation for Economic Co-operation'],
        what: 'A forum of largely high-income economies for policy coordination and statistics. Often the source of comparative economic data quoted in coverage.',
        india: 'Not a member. Engages as a key partner.',
    },
    {
        id: 'g20',
        name: 'G20',
        category: 'grouping',
        match: ['G20', 'G-20', 'Group of Twenty'],
        what: 'The main forum for international economic cooperation, covering most of world output. Rotating presidency; no permanent secretariat.',
        india: 'A member. Held the presidency and hosted the 2023 summit, at which the African Union was admitted.',
    },
    {
        id: 'g7',
        name: 'G7',
        category: 'grouping',
        match: ['G7', 'G-7', 'Group of Seven'],
        what: 'Canada, France, Germany, Italy, Japan, the UK and the US, with the EU attending. Coordinates on economic and security questions among advanced economies.',
        india: 'Not a member, though frequently invited as a guest.',
    },
    {
        id: 'brics',
        name: 'BRICS',
        category: 'grouping',
        match: ['BRICS'],
        what: 'A grouping of major emerging economies, founded by Brazil, Russia, India, China and South Africa and enlarged since 2024. Runs the New Development Bank.',
        india: 'A founding member.',
    },
    {
        id: 'sco',
        name: 'SCO',
        category: 'grouping',
        match: ['SCO', 'Shanghai Cooperation Organisation', 'Shanghai Cooperation Organization'],
        what: 'A Eurasian political, economic and security body led in practice by China and Russia, with a counter-terrorism structure at its core.',
        india: 'A full member since 2017, admitted alongside Pakistan.',
    },
    {
        id: 'quad',
        name: 'Quad',
        category: 'grouping',
        match: ['Quad', 'Quadrilateral Security Dialogue'],
        what: 'An informal strategic dialogue between Australia, India, Japan and the United States, focused on the Indo-Pacific. Not a treaty alliance and has no mutual-defence clause.',
        india: 'A member.',
    },
    {
        id: 'aukus',
        name: 'AUKUS',
        category: 'grouping',
        match: ['AUKUS'],
        what: 'A security partnership between Australia, the United Kingdom and the United States, centred on nuclear-powered submarines and advanced military technology.',
        india: 'Not a member. Frequently confused with the Quad, which India is in.',
    },
    {
        id: 'nato',
        name: 'NATO',
        category: 'grouping',
        match: ['NATO', 'North Atlantic Treaty Organization', 'North Atlantic Treaty Organisation'],
        what: 'A transatlantic military alliance whose Article 5 treats an attack on one member as an attack on all.',
        india: 'Not a member and not a partner.',
    },
    {
        id: 'asean',
        name: 'ASEAN',
        category: 'grouping',
        match: ['ASEAN', 'Association of Southeast Asian Nations'],
        what: 'A ten-member Southeast Asian bloc working by consensus and non-interference. Central to the region’s security architecture through forums it convenes.',
        india: 'Not a member. A dialogue partner, and the focus of the Act East policy.',
    },
    {
        id: 'saarc',
        name: 'SAARC',
        category: 'grouping',
        match: ['SAARC', 'South Asian Association for Regional Cooperation'],
        what: 'The eight-country South Asian regional body. Largely dormant, as its summits require consensus that India–Pakistan relations have not allowed.',
        india: 'A founding member.',
    },
    {
        id: 'bimstec',
        name: 'BIMSTEC',
        category: 'grouping',
        match: ['BIMSTEC'],
        what: 'A Bay of Bengal grouping linking South and Southeast Asia. Has drawn Indian attention as SAARC stalled, since it excludes Pakistan.',
        india: 'A member.',
    },
    {
        id: 'iora',
        name: 'IORA',
        category: 'grouping',
        match: ['IORA', 'Indian Ocean Rim Association'],
        what: 'A regional forum of Indian Ocean littoral states covering maritime safety, trade and fisheries.',
        india: 'A member.',
    },
    {
        id: 'i2u2',
        name: 'I2U2',
        category: 'grouping',
        match: ['I2U2'],
        what: 'A grouping of India, Israel, the UAE and the United States, focused on joint investment in water, energy, food security and transport.',
        india: 'A member — one of the two "I"s.',
    },
    {
        id: 'gcc',
        name: 'GCC',
        category: 'grouping',
        match: ['GCC', 'Gulf Cooperation Council'],
        what: 'Six Arab Gulf monarchies coordinating on economic and security affairs.',
        india: 'Not a member. Its largest trading partners and the destination of much of the Indian diaspora.',
    },
    {
        id: 'opec',
        name: 'OPEC / OPEC+',
        category: 'grouping',
        match: ['OPEC+', 'OPEC'],
        what: 'An oil producers’ cartel coordinating output to influence prices. OPEC+ adds non-members, most significantly Russia.',
        india: 'Not a member. One of the largest importers, so its decisions move Indian fuel prices directly.',
    },
    {
        id: 'nam',
        name: 'Non-Aligned Movement',
        category: 'grouping',
        match: ['Non-Aligned Movement', 'NAM'],
        what: 'A movement of states not formally allied with any major power bloc, founded during the Cold War.',
        india: 'A founding member.',
    },
    {
        id: 'african-union',
        name: 'African Union',
        category: 'grouping',
        match: ['African Union', 'AU summit'],
        what: 'A continental body of African states covering political, security and economic integration, including a standby peace and security architecture.',
        india: 'Not a member. Supported the AU’s admission to the G20 in 2023.',
    },
    {
        id: 'npt',
        name: 'NPT',
        category: 'regime',
        match: ['NPT', 'Non-Proliferation Treaty', 'Nuclear Non-Proliferation Treaty'],
        what: 'Divides signatories into five recognised nuclear-weapon states and the rest, who forgo weapons in exchange for civilian nuclear cooperation.',
        india: 'Not a signatory, on the grounds that the treaty is discriminatory.',
    },
    {
        id: 'ctbt',
        name: 'CTBT',
        category: 'regime',
        match: ['CTBT', 'Comprehensive Nuclear-Test-Ban Treaty', 'Comprehensive Test Ban Treaty'],
        what: 'Bans all nuclear explosive testing. Signed by most states but never entered into force, as specific listed states have not ratified it.',
        india: 'Has not signed.',
    },
    {
        id: 'nsg',
        name: 'Nuclear Suppliers Group',
        category: 'regime',
        match: ['Nuclear Suppliers Group', 'NSG'],
        what: 'An export-control cartel restricting trade in nuclear material and technology, working by consensus.',
        india: 'Not a member — its application has been blocked, chiefly by China, over its NPT status. It did receive a country-specific waiver in 2008.',
    },
    {
        id: 'mtcr',
        name: 'MTCR',
        category: 'regime',
        match: ['MTCR', 'Missile Technology Control Regime'],
        what: 'A voluntary export-control regime limiting the spread of missiles and unmanned systems capable of delivering weapons of mass destruction.',
        india: 'A member since 2016.',
    },
    {
        id: 'unclos',
        name: 'UNCLOS',
        category: 'regime',
        match: ['UNCLOS', 'Law of the Sea'],
        what: 'The convention setting maritime zones — territorial sea, exclusive economic zone, continental shelf — and the rules of navigation. The framework behind most South China Sea and Arctic disputes.',
        india: 'Ratified in 1995.',
    },
    {
        id: 'paris-agreement',
        name: 'Paris Agreement',
        category: 'regime',
        // No "COP28"-style entry: the trailing word boundary cannot match a
        // number, so any such form would only ever match itself literally.
        match: ['Paris Agreement', 'Paris Accord', 'UNFCCC'],
        what: 'The climate treaty under which each country sets its own Nationally Determined Contribution, reviewed at annual COP meetings, aiming to hold warming well below 2°C.',
        india: 'A party, with an NDC including a net-zero target for 2070.',
    },
    {
        id: 'imec',
        name: 'IMEC',
        category: 'corridor',
        match: ['IMEC', 'India-Middle East-Europe Economic Corridor', 'India–Middle East–Europe'],
        what: 'A proposed rail-and-shipping corridor linking India to Europe through the Gulf, announced at the 2023 G20 summit. Widely read as an alternative to China’s Belt and Road.',
        india: 'An initiating partner.',
    },
    {
        id: 'bri',
        name: 'Belt and Road Initiative',
        category: 'corridor',
        match: ['Belt and Road', 'BRI', 'One Belt One Road'],
        what: 'China’s programme of infrastructure lending and construction across Asia, Africa and Europe.',
        india: 'Has declined to join, objecting that the China–Pakistan Economic Corridor runs through territory it claims.',
    },
    {
        id: 'instc',
        name: 'INSTC',
        category: 'corridor',
        match: ['INSTC', 'International North-South Transport Corridor'],
        what: 'A multimodal route linking India to Russia and Europe via Iran and the Caspian, shortening the sea journey through Suez.',
        india: 'A founding participant, with Iran and Russia.',
    },
    {
        id: 'chabahar',
        name: 'Chabahar Port',
        category: 'corridor',
        match: ['Chabahar'],
        what: 'A port on Iran’s south-eastern coast, outside the Strait of Hormuz, giving access to Afghanistan and Central Asia that bypasses Pakistan.',
        india: 'Developed and operated with Indian involvement.',
    },
    {
        id: 'hormuz',
        name: 'Strait of Hormuz',
        category: 'corridor',
        match: ['Strait of Hormuz', 'Hormuz'],
        what: 'The channel between Iran and Oman carrying a large share of seaborne crude oil. The most consequential chokepoint in energy trade.',
        india: 'Most of its imported crude passes through it.',
    },
    {
        id: 'bab-el-mandeb',
        name: 'Bab-el-Mandeb & the Red Sea',
        category: 'corridor',
        match: ['Bab el-Mandeb', 'Bab-el-Mandeb', 'Red Sea shipping', 'Suez Canal'],
        what: 'The strait between the Horn of Africa and Arabia, opening onto the Red Sea and the Suez Canal — the shortest sea route from Asia to Europe.',
        india: 'Attacks on shipping here push Indian exports onto the longer Cape route, raising freight and insurance costs.',
    },
    {
        id: 'act-east',
        name: 'Act East Policy',
        category: 'doctrine',
        match: ['Act East'],
        what: 'India’s policy of deepening economic and strategic ties with Southeast and East Asia, upgraded in 2014 from the earlier Look East policy.',
        india: 'India’s own policy.',
    },
    {
        id: 'neighbourhood-first',
        name: 'Neighbourhood First',
        category: 'doctrine',
        match: ['Neighbourhood First', 'Neighborhood First'],
        what: 'India’s stated priority on relations with immediate neighbours — connectivity, aid and people-to-people links across South Asia.',
        india: 'India’s own policy.',
    },
    {
        id: 'sagar',
        name: 'SAGAR',
        category: 'doctrine',
        match: ['SAGAR'],
        what: '"Security and Growth for All in the Region" — India’s maritime doctrine for the Indian Ocean, articulated in 2015, covering security cooperation and capacity building with littoral states.',
        india: 'India’s own doctrine.',
    },
];

const BY_ID = new Map(TERMS.map((term) => [term.id, term]));
export const termById = (id) => BY_ID.get(id) || null;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// An acronym is written in capitals in real prose, and several of them are
// also ordinary English words. Matching "WHO" case-insensitively tagged a
// story about Indian politics with the World Health Organization, because the
// description contained the word "who" — so forms written in capitals are
// matched in capitals, and only spelled-out names ignore case.
const isAcronym = (form) => form === form.toUpperCase() && /[A-Z]/.test(form);

const build = (forms, flags) => (
    forms.length
        ? new RegExp(
            // Ordered longest-first so "OPEC+" is preferred over "OPEC", and
            // word-bounded so "Quad" does not fire inside "quadrant".
            `(?<![\\w])(${forms.sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\w])`,
            flags,
        )
        : null
);

const PATTERNS = TERMS.map((term) => ({
    term,
    exact: build(term.match.filter(isAcronym), ''),
    loose: build(term.match.filter((form) => !isAcronym(form)), 'i'),
}));

/**
 * The glossary entries a piece of text mentions.
 *
 * Boundary-aware, so an acronym has to stand as its own word, and
 * case-sensitive for acronyms specifically. Returns whole entries in the order
 * they are defined, deduplicated — a headline naming the Quad twice gets one
 * chip.
 */
export function findTerms(...texts) {
    const haystack = texts.filter(Boolean).join(' — ');
    if (!haystack.trim()) return [];
    return PATTERNS
        .filter(({ exact, loose }) => exact?.test(haystack) || loose?.test(haystack))
        .map(({ term }) => term);
}
