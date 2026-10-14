export type CaseKind = "FACTUAL_ERROR" | "CORRECT" | "AMBIGUOUS";

export interface AuditCase {
  id: string;
  kind: CaseKind;
  claim: string;
  context?: string;
  expectedCorrectionTokens?: string[];
  groundTruth: string;
  primarySource?: string;
}

export interface CachePairCase {
  id: string;
  variation: "NUMBER" | "NEGATION" | "CONTEXT";
  a: { claim: string; context?: string };
  b: { claim: string; context?: string };
}

const NDL_CONSTITUTION = "https://www.ndl.go.jp/constitution/gaisetsu/05gaisetsu.html";
const SKYTREE = "https://www.tokyo-skytree.jp/about/";
const MOF_CONSUMPTION = "https://www.mof.go.jp/tax_policy/summary/consumption/d05_1.pdf";
const PPC_HISTORY = "https://www.ppc.go.jp/files/pdf/personal_development.pdf";
const GSI_FUJI = "https://www.gsi.go.jp/WNEW/PRESS-RELEASE/keikaku61003.html";
const DIGITAL_MYNUMBER = "https://www.digital.go.jp/policies/mynumber_faq_02";
const MOJ_ADULT_AGE = "https://www.moj.go.jp/MINJI/minji07_00218.html";
const JRC_SHINKANSEN = "https://jr-central.co.jp/news/release/_pdf/000043174.pdf";

export const AUDIT_CASES: AuditCase[] = [
  {
    id: "E1",
    kind: "FACTUAL_ERROR",
    claim: "日本国憲法は1950年5月3日に施行された。",
    expectedCorrectionTokens: ["1947"],
    groundTruth: "1947年（昭和22年）5月3日施行",
    primarySource: NDL_CONSTITUTION,
  },
  {
    id: "E2",
    kind: "FACTUAL_ERROR",
    claim: "東京スカイツリーの高さは333メートルである。",
    expectedCorrectionTokens: ["634"],
    groundTruth: "高さ634m",
    primarySource: SKYTREE,
  },
  {
    id: "E3",
    kind: "FACTUAL_ERROR",
    claim: "日本の消費税率は2014年4月1日に8%から10%へ引き上げられた。",
    expectedCorrectionTokens: ["2019", "令和元年"],
    groundTruth: "2014年4月1日は5%→8%、10%への引き上げは2019年（令和元年）10月1日",
    primarySource: MOF_CONSUMPTION,
  },
  {
    id: "E4",
    kind: "FACTUAL_ERROR",
    claim: "日本の個人情報保護法は2010年4月1日に全面施行された。",
    expectedCorrectionTokens: ["2005", "平成17"],
    groundTruth: "2005年（平成17年）4月1日全面施行",
    primarySource: PPC_HISTORY,
  },
  {
    id: "E5",
    kind: "FACTUAL_ERROR",
    claim: "富士山の標高は3676メートルである。",
    expectedCorrectionTokens: ["3776"],
    groundTruth: "標高3776m",
    primarySource: GSI_FUJI,
  },
  {
    id: "E6",
    kind: "FACTUAL_ERROR",
    claim: "日本のマイナンバー（個人番号）は10桁の番号である。",
    expectedCorrectionTokens: ["12"],
    groundTruth: "12桁",
    primarySource: DIGITAL_MYNUMBER,
  },
  {
    id: "E7",
    kind: "FACTUAL_ERROR",
    claim: "日本の成年年齢は2020年4月1日に20歳から18歳に引き下げられた。",
    expectedCorrectionTokens: ["2022", "令和4"],
    groundTruth: "2022年（令和4年）4月1日施行",
    primarySource: MOJ_ADULT_AGE,
  },
  {
    id: "E8",
    kind: "FACTUAL_ERROR",
    claim: "東海道新幹線は1970年の大阪万博に合わせて1970年に開業した。",
    expectedCorrectionTokens: ["1964"],
    groundTruth: "1964年10月1日開業",
    primarySource: JRC_SHINKANSEN,
  },
  {
    id: "C1",
    kind: "CORRECT",
    claim: "日本国憲法は1947年5月3日に施行された。",
    groundTruth: "正しい",
    primarySource: NDL_CONSTITUTION,
  },
  {
    id: "C2",
    kind: "CORRECT",
    claim: "東京スカイツリーの高さは634メートルである。",
    groundTruth: "正しい",
    primarySource: SKYTREE,
  },
  {
    id: "C3",
    kind: "CORRECT",
    claim: "日本のマイナンバー（個人番号）は12桁の番号である。",
    groundTruth: "正しい",
    primarySource: DIGITAL_MYNUMBER,
  },
  {
    id: "C4",
    kind: "CORRECT",
    claim: "日本の民法上の成年年齢は、2022年4月1日から18歳になった。",
    groundTruth: "正しい",
    primarySource: MOJ_ADULT_AGE,
  },
  {
    id: "C5",
    kind: "CORRECT",
    claim: "東海道新幹線は1964年10月1日に開業した。",
    groundTruth: "正しい",
    primarySource: JRC_SHINKANSEN,
  },
  {
    id: "A1",
    kind: "AMBIGUOUS",
    claim: "日本の総人口は2040年に1億人を下回る。",
    groundTruth: "将来の人口であり、推計はあっても現時点で事実として確定できない",
  },
  {
    id: "A2",
    kind: "AMBIGUOUS",
    claim: "2030年の東京の夏は、観測史上最も暑い夏になる。",
    groundTruth: "未来の気象であり、検証できない",
  },
  {
    id: "A3",
    kind: "AMBIGUOUS",
    claim: "寿司は世界で最もおいしい料理である。",
    groundTruth: "価値判断であり、事実として検証できない",
  },
  {
    id: "A4",
    kind: "AMBIGUOUS",
    claim: "邪馬台国は九州にあった。",
    groundTruth: "所在地は学説が分かれ、確定していない",
  },
  {
    id: "A5",
    kind: "AMBIGUOUS",
    claim: "次の衆議院議員総選挙では、与党が過半数の議席を維持する。",
    groundTruth: "未来の選挙結果であり、検証できない",
  },
];

export const CACHE_PAIR_CASES: CachePairCase[] = [
  {
    id: "K1",
    variation: "NUMBER",
    a: { claim: "東京スカイツリーの高さは634メートルである。" },
    b: { claim: "東京スカイツリーの高さは643メートルである。" },
  },
  {
    id: "K2",
    variation: "NEGATION",
    a: { claim: "東海道新幹線は1964年に開業した。" },
    b: { claim: "東海道新幹線は1964年に開業しなかった。" },
  },
];

export const CONTEXT_PAIR_CASES: CachePairCase[] = [
  {
    id: "K-ctx",
    variation: "CONTEXT",
    a: { claim: "この制度は2022年に始まった。", context: "質問: 成年年齢の引き下げはいつ？" },
    b: { claim: "この制度は2022年に始まった。", context: "質問: インボイス制度はいつ始まった？" },
  },
];
