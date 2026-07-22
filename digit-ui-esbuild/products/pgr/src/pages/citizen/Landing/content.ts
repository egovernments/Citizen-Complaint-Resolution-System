// Content model + built-in copy deck for the PGR public landing page.
//
// Every user-visible string resolves in three steps (see useLandingCopy.ts):
//   1. MDMS/i18next translation for key `PGR_LANDING_<KEY>` — wins when seeded.
//   2. Built-in copy below, picked by the active i18n language (pt / en).
//   3. The raw key (never expected to surface).
//
// PT copy follows Mozambican orthography (pre-1990 Acordo: "actividades",
// "protecção", "actualizações") to match the rest of the mz deployment.
//
// News defaults mirror the approved prototype's seeded articles; production
// deployments pass real items via the `news` prop on <PGRLandingPage />.

import type * as React from "react";
import {
  FileText,
  Megaphone,
  Scale,
  ShieldAlert,
  Send,
  Hash,
  FileSearch,
  UserCheck,
  Search,
  CheckCircle2,
  Globe,
  Smartphone,
  MessageCircle,
  Phone,
  Landmark,
  Store,
} from "lucide-react";
import type { LandingRoutes } from "./routes";

// Loose icon type: lucide-react@1.x has no LucideIcon export.
export type IconComponent = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export const LANDING_COPY = {
  // Chrome ------------------------------------------------------------------
  GOV_NAME: { pt: "República de Moçambique", en: "Republic of Mozambique" },
  PORTAL_NAME: { pt: "Fala Cidadão", en: "Complaints and Reports Portal" },
  ORG_NAMES: { pt: "IGE e IGSAE", en: "IGE and IGSAE" },
  TAGLINE: { pt: "O cidadão fala. O Estado responde.", en: "The citizen speaks. The State responds." },
  MOTTO_VALUES: { pt: "Transparência · Integridade", en: "Transparency · Integrity" },
  SKIP_LINK: { pt: "Saltar para o conteúdo principal", en: "Skip to main content" },
  UTILITY_PHONE_LABEL: { pt: "+258 21 490 000", en: "+258 21 490 000" },
  UTILITY_GREEN_LINE: { pt: "Linha Verde 1490", en: "Green Line 1490" },
  UTILITY_GREEN_LINE_FREE: { pt: "gratuita", en: "toll-free" },
  LOGIN: { pt: "Entrar", en: "Sign in" },
  ARIA_LANGUAGE: { pt: "Idioma", en: "Language" },
  ARIA_UTILITY: { pt: "Informação de serviço", en: "Service information" },

  // Navigation ---------------------------------------------------------------
  ARIA_MAIN_NAV: { pt: "Navegação principal", en: "Main navigation" },
  NAV_MENU_OPEN: { pt: "Abrir menu", en: "Open menu" },
  NAV_MENU_CLOSE: { pt: "Fechar menu", en: "Close menu" },
  NAV_HOME: { pt: "Início", en: "Home" },
  NAV_SUBMIT: { pt: "Submeter Manifestação", en: "Submit a Case" },
  NAV_TRACK: { pt: "Acompanhar Processo", en: "Track a Case" },
  NAV_TRAINING: { pt: "Formação e Ajuda", en: "Training & Help" },
  NAV_ABOUT: { pt: "Sobre o Portal", en: "About the Portal" },
  NAV_CONTACTS: { pt: "Contactos", en: "Contacts" },

  // Hero -----------------------------------------------------------------—--
  HERO_EYEBROW: { pt: "República de Moçambique · IGE · IGSAE", en: "Republic of Mozambique · IGE · IGSAE" },
  HERO_TITLE: { pt: "Fala Cidadão", en: "Complaints and Reports Portal" },
  HERO_LEDE: {
    pt: "Canal nacional para reclamações, queixas, petições e denúncias sobre serviços públicos, administração pública e actividades económicas — com acompanhamento simples, seguro e transparente.",
    en: "The national channel for complaints, grievances, petitions and reports about public services, public administration and economic activities — with simple, secure and transparent tracking.",
  },
  HERO_CTA_SUBMIT: { pt: "Submeter Manifestação", en: "Submit a Case" },
  HERO_CTA_TRACK: { pt: "Acompanhar Processo", en: "Track a Case" },
  HERO_TRUST_CONFIDENTIAL: { pt: "Tratamento confidencial", en: "Confidential handling" },
  HERO_TRUST_CASE_NUMBER: { pt: "Número de processo único", en: "Unique case number" },
  HERO_TRUST_NOTIFICATIONS: { pt: "Notificações por SMS e WhatsApp", en: "SMS & WhatsApp notifications" },
  HERO_CHANNELS_LABEL: { pt: "Também disponível em:", en: "Also available on:" },
  HERO_CHANNEL_APP: { pt: "Aplicação Android", en: "Android App" },
  HERO_CHANNEL_WA: { pt: "WhatsApp Oficial", en: "Official WhatsApp" },
  HERO_CHANNEL_LINE: { pt: "Linha Verde 1490", en: "Green Line 1490" },

  // Manifestation types -------------------------------------------------—--
  TYPES_TITLE: { pt: "Tipos de Manifestação", en: "Types of Submission" },
  TYPES_INTRO: {
    pt: "Escolha o tipo que melhor descreve a sua situação. Em caso de dúvida, seleccione o mais próximo — os serviços encaminham a manifestação correctamente.",
    en: "Choose the type that best describes your situation. If unsure, pick the closest — our services will route it correctly.",
  },
  TYPE_COMPLAINT_TITLE: { pt: "Reclamações", en: "Complaints" },
  TYPE_COMPLAINT_DESC: {
    pt: "Insatisfação com a qualidade, disponibilidade ou atendimento dos serviços prestados por órgãos e instituições da Administração Pública.",
    en: "Dissatisfaction with the quality, availability or service provided by public administration bodies and institutions.",
  },
  TYPE_GRIEVANCE_TITLE: { pt: "Queixas", en: "Grievances" },
  TYPE_GRIEVANCE_DESC: {
    pt: "Comunicação de má conduta, negligência, abuso de poder ou incumprimento de deveres por funcionários, agentes ou instituições públicas.",
    en: "Reporting misconduct, negligence, abuse of power or failure to perform duties by public officials, agents or institutions.",
  },
  TYPE_REPORT_TITLE: { pt: "Denúncias", en: "Reports" },
  TYPE_REPORT_DESC: {
    pt: "Comunicação de factos ligados a actividades económicas, defesa do consumidor, segurança alimentar ou infracções de operadores económicos.",
    en: "Reporting facts related to economic activities, consumer protection, food safety or infractions by economic operators.",
  },
  TYPE_CTA: { pt: "Submeter", en: "Submit" },

  // How it works -----------------------------------------------------------
  HOW_TITLE: { pt: "Como Funciona", en: "How it Works" },
  HOW_STEP_LABEL: { pt: "Passo", en: "Step" },
  HOW_STEP_1: { pt: "Submeta a sua manifestação", en: "Submit your case" },
  HOW_STEP_2: { pt: "Receba o número de processo", en: "Receive your case number" },
  HOW_STEP_3: { pt: "A manifestação é analisada", en: "Your case is reviewed" },
  HOW_STEP_4: { pt: "A entidade competente é accionada", en: "The competent authority is engaged" },
  HOW_STEP_5: { pt: "Acompanhe o estado do processo", en: "Track the case status" },
  HOW_STEP_6: { pt: "Receba a decisão final", en: "Receive the final decision" },
  HOW_NOTE_TITLE: { pt: "Acompanhamento garantido", en: "Guaranteed follow-up" },
  HOW_NOTE_NOTIFY: {
    pt: "Recebe notificações por SMS ou WhatsApp sempre que o estado do processo muda.",
    en: "You receive an SMS or WhatsApp notification every time the case status changes.",
  },
  HOW_NOTE_RECORD: {
    pt: "Todo o processo fica registado digitalmente, garantindo transparência, rastreabilidade e responsabilização.",
    en: "The entire process is digitally recorded, ensuring transparency, traceability and accountability.",
  },
  HOW_NOTE_CHANNELS: {
    pt: "Qualquer canal — Portal, Aplicação ou WhatsApp — gera um número único de processo para acompanhamento.",
    en: "Every channel — Portal, App or WhatsApp — issues a unique case number for tracking.",
  },

  // Channels -----------------------------------------------------------—---
  CHANNELS_TITLE: { pt: "Canais de Atendimento", en: "Service Channels" },
  CHANNELS_INTRO: {
    pt: "Use o Portal Web para a experiência completa de submissão e acompanhamento, ou escolha o canal mais conveniente para si.",
    en: "Use the Web Portal for the full submission and tracking experience, or pick the channel that suits you best.",
  },
  CHANNEL_WEB_TITLE: { pt: "Portal Web", en: "Web Portal" },
  CHANNEL_WEB_DESC: { pt: "Submissão e acompanhamento completos, com histórico do processo.", en: "Full submission and tracking, with complete case history." },
  CHANNEL_WEB_CTA: { pt: "Submeter agora", en: "Submit now" },
  CHANNEL_WEB_BADGE: { pt: "Está aqui", en: "You are here" },
  CHANNEL_APP_TITLE: { pt: "Aplicação Android", en: "Android App" },
  CHANNEL_APP_DESC: { pt: "Submeta e acompanhe manifestações a partir do telemóvel.", en: "Submit and track cases from your mobile phone." },
  CHANNEL_APP_CTA: { pt: "Obter no Google Play", en: "Get it on Google Play" },
  CHANNEL_WA_TITLE: { pt: "WhatsApp Oficial", en: "Official WhatsApp" },
  CHANNEL_WA_DESC: { pt: "Submeta manifestações e receba apoio pela conversa oficial.", en: "Submit cases and get support through the official chat." },
  CHANNEL_WA_CTA: { pt: "Conversar no WhatsApp", en: "Chat on WhatsApp" },
  CHANNEL_LINE_TITLE: { pt: "Linha Verde 1490", en: "Green Line 1490" },
  CHANNEL_LINE_DESC: { pt: "Chamada gratuita para apoio, orientação e submissão assistida.", en: "Toll-free call for support, guidance and assisted submission." },
  CHANNEL_LINE_CTA: { pt: "Ligar 1490", en: "Call 1490" },

  // Privacy ------------------------------------------------------------—---
  PRIVACY_TITLE: { pt: "Confidencialidade e Protecção de Dados", en: "Confidentiality and Data Protection" },
  PRIVACY_P1: {
    pt: "O portal protege os dados pessoais dos cidadãos de acordo com a legislação aplicável.",
    en: "The portal protects citizens' personal data in accordance with applicable legislation.",
  },
  PRIVACY_P2: {
    pt: "Ao submeter uma manifestação, pode solicitar tratamento confidencial dos seus dados. Nesses casos, a sua identidade não fica visível aos utilizadores responsáveis pela gestão e tramitação do processo, excepto quando exigido por lei.",
    en: "When submitting a case you may request confidential treatment of your data. Your identity is then hidden from the users managing and processing the case, except where required by law.",
  },
  PRIVACY_LINK: { pt: "Ler a Política de Privacidade", en: "Read the Privacy Policy" },

  // Privacy policy (full page) ---------------------------------------------
  PRIVACY_PAGE_TITLE: { pt: "Política de Privacidade", en: "Privacy Policy" },
  PRIVACY_PAGE_P1: {
    pt: "A Plataforma Fala Cidadão está empenhada em proteger a sua privacidade e em assegurar que as suas informações pessoais são tratadas de forma segura, transparente e em conformidade com a legislação aplicável.",
    en: "The Fala Cidadão Platform is committed to protecting your privacy and ensuring your personal information is handled securely, transparently and in compliance with applicable law.",
  },
  PRIVACY_PAGE_P2: {
    pt: "Ao utilizar esta Plataforma, o utilizador consente na recolha e no tratamento das informações que fornece para efeitos de registo, investigação, gestão e resolução da sua reclamação, petições, queixas e denúncia. As informações recolhidas podem incluir o seu nome, dados de contacto, elementos de identificação quando aplicável, detalhes da reclamação, documentos de suporte, fotografias e outras provas que decida apresentar.",
    en: "By using this Platform you consent to the collection and processing of the information you provide to register, investigate, manage and resolve your complaint, petitions, grievances and reports. This may include your name, contact details, identifying details where applicable, complaint details, supporting documents, photographs and other evidence you submit.",
  },
  PRIVACY_PAGE_P3: {
    pt: "As suas informações pessoais apenas serão acedidas por funcionários e instituições do Governo devidamente autorizados e responsáveis pelo tratamento da sua reclamação. Não serão partilhadas com terceiros não autorizados nem utilizadas para fins comerciais ou de marketing. Nos casos previstos pela Plataforma, as reclamações submetidas como confidenciais terão a identidade do autor protegida, sendo esta divulgada apenas para um grupo restrito e senior de funcionarios ou quando exigido por lei.",
    en: "Your personal information will only be accessed by duly authorised government officials and institutions responsible for handling your complaint. It will not be shared with unauthorised third parties or used for commercial or marketing purposes. Where the Platform allows, complaints submitted as confidential will have the author's identity protected, disclosed only to a restricted, senior group of officials or when required by law.",
  },
  PRIVACY_PAGE_P4: {
    pt: "A Plataforma implementa medidas técnicas e organizativas adequadas para salvaguardar as suas informações contra o acesso, alteração, divulgação ou perda não autorizados. Podem igualmente ser recolhidas informações técnicas, tais como dados do dispositivo, endereço IP e utilização do sistema, com o objetivo de melhorar a segurança, o desempenho do sistema e a qualidade do serviço.",
    en: "The Platform implements appropriate technical and organisational measures to safeguard your information against unauthorised access, alteration, disclosure or loss. Technical information may also be collected, such as device data, IP address and system usage, to improve security, system performance and service quality.",
  },
  PRIVACY_PAGE_P5: {
    pt: "As suas informações serão conservadas apenas durante o período necessário para processar a sua reclamação, cumprir obrigações legais e manter os registos oficiais do Governo. O utilizador pode solicitar o acesso às suas informações pessoais ou a respetiva correção, sujeito à legislação aplicável e a quaisquer restrições necessárias para proteger investigações em curso.",
    en: "Your information will be retained only for the period necessary to process your complaint, comply with legal obligations and maintain official government records. You may request access to or correction of your personal information, subject to applicable law and any restrictions necessary to protect ongoing investigations.",
  },

  // News ---------------------------------------------------------------—---
  NEWS_TITLE: { pt: "Últimas Actualizações", en: "Latest Updates" },
  NEWS_READ_MORE: { pt: "Ler mais", en: "Read more" },
  NEWS_VIEW_ALL: { pt: "Ver todas as actualizações", en: "See all updates" },

  // Institutions -------------------------------------------------------—---
  INST_TITLE: { pt: "IGE e IGSAE ao serviço do cidadão", en: "IGE and IGSAE at the citizen's service" },
  INST_IGE_TITLE: { pt: "Inspecção-Geral do Estado (IGE)", en: "General State Inspectorate (IGE)" },
  INST_IGE_DESC: {
    pt: "Órgão central de controlo interno da Administração Pública, responsável pela auditoria, fiscalização e inspecção da legalidade, regularidade, eficiência e eficácia da utilização dos recursos públicos.",
    en: "Central internal-control body of the public administration, responsible for auditing, oversight and inspection of the legality, regularity, efficiency and effectiveness of the use of public resources.",
  },
  INST_IGSAE_TITLE: { pt: "Inspecção-Geral de Segurança Alimentar e Económica (IGSAE)", en: "General Inspectorate of Food and Economic Safety (IGSAE)" },
  INST_IGSAE_DESC: {
    pt: "Órgão responsável pela fiscalização das actividades económicas, defesa do consumidor e segurança alimentar, promovendo o cumprimento da legislação aplicável e a protecção do interesse público.",
    en: "Body responsible for overseeing economic activities, consumer protection and food safety, promoting compliance with applicable legislation and the protection of the public interest.",
  },

  // Final CTA ----------------------------------------------------------—---
  // Title-cased type names echo the four card titles (prototype convention).
  FINAL_TITLE: { pt: "Tem uma Reclamação, Queixa, Petição ou Denúncia?", en: "Have a Complaint, Grievance, Petition or Report?" },
  FINAL_TEXT: {
    pt: "Participe na melhoria dos serviços públicos e da actividade económica. Submeta a sua manifestação e acompanhe o tratamento através do portal.",
    en: "Help improve public services and economic activity. Submit your case and follow its handling through the portal.",
  },
  FINAL_CTA: { pt: "Submeter Manifestação", en: "Submit a Case" },

  // Footer -------------------------------------------------------------—---
  FOOTER_CHANNELS: { pt: "Canais Oficiais", en: "Official Channels" },
  FOOTER_LINKS: { pt: "Links Úteis", en: "Useful Links" },
  FOOTER_ACCESS: { pt: "Acesso", en: "Access" },
  FOOTER_LEGAL: { pt: "Informação Legal", en: "Legal" },
  FOOTER_PORTAL_WEB: { pt: "Portal Web", en: "Web Portal" },
  FOOTER_ANDROID: { pt: "Aplicação Android", en: "Android App" },
  FOOTER_WHATSAPP: { pt: "WhatsApp Oficial", en: "Official WhatsApp" },
  FOOTER_GREEN_LINE: { pt: "Linha Verde 1490", en: "Green Line 1490" },
  FOOTER_FAQ: { pt: "Perguntas Frequentes", en: "FAQ" },
  FOOTER_CITIZEN_LOGIN: { pt: "Entrar como Cidadão", en: "Citizen Sign in" },
  FOOTER_EMPLOYEE_LOGIN: { pt: "Acesso de Funcionário", en: "Employee Access" },
  FOOTER_PRIVACY: { pt: "Política de Privacidade", en: "Privacy Policy" },
  FOOTER_TERMS: { pt: "Termos de Utilização", en: "Terms of Use" },
  FOOTER_ACCESSIBILITY: { pt: "Acessibilidade", en: "Accessibility" },
  FOOTER_COPYRIGHT: {
    pt: "Fala Cidadão · República de Moçambique. Todos os direitos reservados.",
    en: "Complaints and Reports Portal · Republic of Mozambique. All rights reserved.",
  },

  // Misc ---------------------------------------------------------------—---
  FAB_LABEL: { pt: "Falar connosco no WhatsApp", en: "Chat with us on WhatsApp" },
  PLACEHOLDER_PENDING: { pt: "Página em configuração", en: "Page being configured" },
  EXTERNAL_LINK_NOTE: { pt: "abre numa nova janela", en: "opens in a new window" },
} as const;

export type LandingCopyKey = keyof typeof LANDING_COPY;

// ---------------------------------------------------------------------------
// Structured section data
// ---------------------------------------------------------------------------

export interface NavItem {
  labelKey: LandingCopyKey;
  route: keyof LandingRoutes;
}

export const NAV_ITEMS: NavItem[] = [
  { labelKey: "NAV_HOME", route: "HOME" },
  { labelKey: "NAV_SUBMIT", route: "REGISTER_COMPLAINT" },
  { labelKey: "NAV_TRACK", route: "TRACK_COMPLAINT" }
];

export interface ManifestationType {
  id: string;
  icon: IconComponent;
  titleKey: LandingCopyKey;
  descKey: LandingCopyKey;
  /** CSS var (HSL triple) driving the card's accent tint. */
  accentVar: string;
  route: keyof LandingRoutes;
}

export const MANIFESTATION_TYPES: ManifestationType[] = [
  { id: "reclamacao", icon: FileText, titleKey: "TYPE_COMPLAINT_TITLE", descKey: "TYPE_COMPLAINT_DESC", accentVar: "--pgrl-type-complaint", route: "REGISTER_COMPLAINT" },
  { id: "queixa", icon: Megaphone, titleKey: "TYPE_GRIEVANCE_TITLE", descKey: "TYPE_GRIEVANCE_DESC", accentVar: "--pgrl-type-grievance", route: "REGISTER_COMPLAINT" },
  { id: "denuncia", icon: ShieldAlert, titleKey: "TYPE_REPORT_TITLE", descKey: "TYPE_REPORT_DESC", accentVar: "--pgrl-type-report", route: "REGISTER_COMPLAINT" },
];

export interface HowStep {
  icon: IconComponent;
  titleKey: LandingCopyKey;
}

export const HOW_STEPS: HowStep[] = [
  { icon: Send, titleKey: "HOW_STEP_1" },
  { icon: Hash, titleKey: "HOW_STEP_2" },
  { icon: FileSearch, titleKey: "HOW_STEP_3" },
  { icon: UserCheck, titleKey: "HOW_STEP_4" },
  { icon: Search, titleKey: "HOW_STEP_5" },
  { icon: CheckCircle2, titleKey: "HOW_STEP_6" },
];

export interface ChannelItem {
  id: string;
  icon: IconComponent;
  titleKey: LandingCopyKey;
  descKey: LandingCopyKey;
  ctaKey: LandingCopyKey;
  route: keyof LandingRoutes;
  /** Chip shown on the current channel ("Está aqui"). */
  badgeKey?: LandingCopyKey;
  external?: boolean;
}

export const CHANNELS: ChannelItem[] = [
  { id: "web", icon: Globe, titleKey: "CHANNEL_WEB_TITLE", descKey: "CHANNEL_WEB_DESC", ctaKey: "CHANNEL_WEB_CTA", route: "REGISTER_COMPLAINT", badgeKey: "CHANNEL_WEB_BADGE" },
  { id: "app", icon: Smartphone, titleKey: "CHANNEL_APP_TITLE", descKey: "CHANNEL_APP_DESC", ctaKey: "CHANNEL_APP_CTA", route: "ANDROID_APP", external: true },
  { id: "whatsapp", icon: MessageCircle, titleKey: "CHANNEL_WA_TITLE", descKey: "CHANNEL_WA_DESC", ctaKey: "CHANNEL_WA_CTA", route: "WHATSAPP", external: true },
  { id: "greenline", icon: Phone, titleKey: "CHANNEL_LINE_TITLE", descKey: "CHANNEL_LINE_DESC", ctaKey: "CHANNEL_LINE_CTA", route: "GREEN_LINE" },
];

export interface InstitutionItem {
  icon: IconComponent;
  titleKey: LandingCopyKey;
  descKey: LandingCopyKey;
}

export const INSTITUTIONS: InstitutionItem[] = [
  { icon: Landmark, titleKey: "INST_IGE_TITLE", descKey: "INST_IGE_DESC" },
  { icon: Store, titleKey: "INST_IGSAE_TITLE", descKey: "INST_IGSAE_DESC" },
];

export interface NewsItem {
  id: string;
  /** Pre-formatted display date (news is CMS content — not run through i18n). */
  dateLabel: string;
  /** ISO date for the <time> element. */
  dateTime: string;
  tag: string;
  title: string;
  excerpt: string;
  source: string;
  href: string;
  imageUrl?: string;
}

export const DEFAULT_NEWS: NewsItem[] = [
  {
    id: "piloto-norte",
    dateLabel: "07 Jul 2026",
    dateTime: "2026-07-07",
    tag: "Portal",
    title: "Fala Cidadão inicia fase piloto em três províncias do norte do país",
    excerpt:
      "O Governo de Moçambique lançou oficialmente a fase piloto do Portal nas províncias de Nampula, Cabo Delgado e Niassa, com expansão gradual prevista para os próximos três meses.",
    source: "Fala Cidadão",
    href: "#",
  },
  {
    id: "formacao-equipamentos",
    dateLabel: "03 Jul 2026",
    dateTime: "2026-07-03",
    tag: "Capacitação",
    title: "Funcionários da IGE e IGSAE recebem formação e equipamentos para operacionalização da plataforma",
    excerpt:
      "Vinte e cinco funcionários concluíram a formação sobre utilização do Portal, com disponibilização de equipamentos informáticos para garantir a gestão eficiente dos casos.",
    source: "IGE & IGSAE",
    href: "#",
  },
  {
    id: "formadores-comunitarios",
    dateLabel: "01 Jul 2026",
    dateTime: "2026-07-01",
    tag: "Mobilização Comunitária",
    title: "Mil formadores comunitários capacitados para promover a utilização do portal em todo o país",
    excerpt:
      "Formadores de todas as províncias actuarão como embaixadores da plataforma, apoiando a sensibilização dos cidadãos e o uso dos canais digitais junto das suas comunidades.",
    source: "Fala Cidadão",
    href: "#",
  },
  {
    id: "pr-fiscalizacao",
    dateLabel: "20 Mai 2026",
    dateTime: "2026-05-20",
    tag: "Presidência da República",
    title: "Presidente da República desafia Inspecção-Geral do Estado a reforçar fiscalização e combate à corrupção",
    excerpt:
      "O Chefe do Estado destacou a importância da responsabilização e da modernização dos mecanismos de controlo interno, rumo a uma Administração Pública mais íntegra e transparente.",
    source: "Portal do Governo",
    href: "https://portaldogoverno.gov.mz/2026/05/20/pr-desafia-inspeccao-geral-do-estado-a-reforcar-fiscalizacao-e-combate-a-corrupcao/",
  },
];
