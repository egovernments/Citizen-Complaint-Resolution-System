/**
 * i18n provider bridging react-admin's polyglot with DIGIT's localization API.
 *
 * Architecture:
 * - English is the ONLY fully-bundled locale (needed synchronously on boot).
 * - All `app.*` translations for non-English locales are fetched from DIGIT's
 *   localization API on demand (module: "configurator-ui").
 * - `ra.*` framework strings (react-admin internals) are bundled per-locale
 *   since they're not stored in DIGIT. These are compact — just action/page/
 *   navigation/validation strings.
 * - API translations are deep-merged on top of the bundled base, so the DIGIT
 *   backend is the source of truth for all `app.*` keys.
 * - To add a new language: seed it in DIGIT via localization_upsert, add its
 *   `ra.*` bundle below, and add an entry to AVAILABLE_LOCALES.
 */
import polyglotI18nProvider from 'ra-i18n-polyglot';
import englishMessages from 'ra-language-english';
import type { TranslationMessages, Locale } from 'ra-core';
import { digitClient } from './bridge';

// ---------------------------------------------------------------------------
// Available locales — add new ones here + seed app.* keys in DIGIT API
// ---------------------------------------------------------------------------
export const AVAILABLE_LOCALES: Locale[] = [
  { locale: 'en_IN', name: 'EN' },
  { locale: 'hi_IN', name: 'HI' },
  { locale: 'pt_BR', name: 'PT' },
  { locale: 'fr_FR', name: 'FR' },
];

// ---------------------------------------------------------------------------
// Bundled: English (full — ra.* from package + app.* as fallback)
// ---------------------------------------------------------------------------
const customEnglishMessages: TranslationMessages = {
  ...englishMessages,
  app: {
    nav: {
      dashboard: 'Dashboard',
      tenant_management: 'Tenant Management',
      tenants: 'Tenants',
      departments: 'Departments',
      designations: 'Designations',
      hierarchies: 'Hierarchies',
      complaint_management: 'Complaint Management',
      complaint_types: 'Complaint Types',
      complaints: 'Complaints',
      localization: 'Localization',
      people: 'People',
      employees: 'Employees',
      users: 'Users',
      system: 'System',
      access_roles: 'Access Roles',
      workflows: 'Workflows',
      processes: 'Processes',
      mdms_schemas: 'MDMS Schemas',
      boundaries: 'Boundaries',
      advanced: 'Advanced',
      switch_to_onboarding: 'Switch to Onboarding',
    },
    header: {
      management_mode: 'Management Mode',
      title: 'DIGIT Management Studio',
    },
    resources: {
      complaint_types: 'Complaint Types',
      departments: 'Departments',
      designations: 'Designations',
      tenants: 'Tenants',
      employees: 'Employees',
      users: 'Users',
      complaints: 'Complaints',
      boundaries: 'Boundaries',
      localization: 'Localization Messages',
      access_roles: 'Access Roles',
      access_actions: 'Access Actions',
      role_actions: 'Role Actions',
      workflow_services: 'Workflow Business Services',
      workflow_processes: 'Workflow Processes',
      mdms_schemas: 'MDMS Schemas',
      boundary_hierarchies: 'Boundary Hierarchies',
    },
    fields: {
      code: 'Code',
      name: 'Name',
      description: 'Description',
      status: 'Status',
      active: 'Active',
      service_code: 'Service Code',
      department: 'Department',
      sla_hours: 'SLA (hrs)',
      city: 'City',
      district: 'District',
      mobile: 'Mobile',
      designation: 'Designation',
      username: 'Username',
      type: 'Type',
      roles: 'Roles',
      boundary_type: 'Boundary Type',
      tenant: 'Tenant',
      message: 'Message',
      module: 'Module',
      locale: 'Locale',
      url: 'URL',
      service: 'Service',
      enabled: 'Enabled',
      role_code: 'Role Code',
      action_id: 'Action ID',
      action_code: 'Action Code',
      business_service: 'Business Service',
      business: 'Business',
      sla: 'SLA',
      business_id: 'Business ID',
      action: 'Action',
      state: 'State',
      created: 'Created',
      hierarchy_type: 'Hierarchy Type',
      request_id: 'Request ID',
      citizen: 'Citizen',
      locality: 'Locality',
    },
    list: {
      refresh: 'Refresh',
      create: 'Create',
      search: 'Search...',
      loading: 'Loading...',
      error_loading: 'Error loading data',
      error_unexpected: 'An unexpected error occurred',
      try_again: 'Try again',
      no_records: 'No records found',
      adjust_search: 'Try adjusting your search query',
      showing: 'Showing %{start}-%{end} of %{total}',
      previous: 'Previous',
      next: 'Next',
      page_info: 'Page %{page} of %{totalPages}',
      actions: 'Actions',
      columns: 'Columns',
      show_columns: 'Show columns',
      reset: 'Reset',
      rows_per_page: 'Rows per page:',
    },
  },
};

// ---------------------------------------------------------------------------
// Bundled: ra.* framework strings per locale (NOT stored in DIGIT API)
// These are react-admin internals — action labels, validation messages, etc.
// Only ra.* keys go here; app.* keys come from DIGIT's localization API.
// ---------------------------------------------------------------------------
const RA_BUNDLES: Record<string, { ra: Record<string, unknown> }> = {
  hi_IN: {
    ra: {
      action: {
        add_filter: 'फ़िल्टर जोड़ें', add: 'जोड़ें', back: 'वापस जाएं',
        bulk_actions: '1 आइटम चयनित |||| %{smart_count} आइटम चयनित',
        cancel: 'रद्द करें', clear_array_input: 'सूची साफ़ करें', clear_input_value: 'मान साफ़ करें',
        clone: 'क्लोन', confirm: 'पुष्टि करें', create: 'बनाएं', create_item: '%{item} बनाएं',
        delete: 'हटाएं', edit: 'संपादित करें', export: 'निर्यात करें', list: 'सूची',
        refresh: 'ताज़ा करें', remove_filter: 'यह फ़िल्टर हटाएं', remove_all_filters: 'सभी फ़िल्टर हटाएं',
        remove: 'हटाएं', reset: 'रीसेट', save: 'सहेजें', search: 'खोजें',
        select_all: 'सभी चुनें', select_row: 'यह पंक्ति चुनें', show: 'दिखाएं',
        sort: 'क्रमबद्ध करें', undo: 'पूर्ववत करें', unselect: 'अचयनित करें',
        expand: 'विस्तार करें', close: 'बंद करें', open_menu: 'मेनू खोलें', close_menu: 'मेनू बंद करें',
        update: 'अपडेट', open: 'खोलें', toggle_theme: 'लाइट/डार्क मोड टॉगल करें', select_columns: 'कॉलम',
      },
      boolean: { true: 'हाँ', false: 'नहीं', null: ' ' },
      page: {
        create: '%{name} बनाएं', dashboard: 'डैशबोर्ड', edit: '%{name} %{recordRepresentation}',
        error: 'कुछ गलत हो गया', list: '%{name}', loading: 'लोड हो रहा है', not_found: 'नहीं मिला',
        show: '%{name} %{recordRepresentation}', empty: 'अभी कोई %{name} नहीं है।',
        invite: 'क्या आप एक जोड़ना चाहते हैं?',
      },
      navigation: {
        clear_filters: 'फ़िल्टर साफ़ करें',
        no_filtered_results: 'वर्तमान फ़िल्टर से कोई %{name} नहीं मिला।',
        no_results: 'कोई %{name} नहीं मिला',
        no_more_results: 'पृष्ठ संख्या %{page} सीमा से बाहर है।',
        page_out_of_boundaries: 'पृष्ठ संख्या %{page} सीमा से बाहर',
        page_out_from_end: 'अंतिम पृष्ठ के बाद नहीं जा सकते',
        page_out_from_begin: 'पृष्ठ 1 से पहले नहीं जा सकते',
        page_range_info: '%{offsetBegin}-%{offsetEnd} कुल %{total} में से',
        partial_page_range_info: '%{offsetBegin}-%{offsetEnd} / %{offsetEnd} से अधिक',
        current_page: 'पृष्ठ %{page}', page: 'पृष्ठ %{page} पर जाएं',
        first: 'पहले पृष्ठ पर जाएं', last: 'अंतिम पृष्ठ पर जाएं',
        next: 'अगले पृष्ठ पर जाएं', previous: 'पिछले पृष्ठ पर जाएं',
        page_rows_per_page: 'प्रति पृष्ठ पंक्तियाँ:', skip_nav: 'सामग्री पर जाएं',
      },
      sort: { sort_by: '%{field_lower_first} %{order} के अनुसार क्रमबद्ध', ASC: 'आरोही', DESC: 'अवरोही' },
      auth: {
        auth_check_error: 'कृपया जारी रखने के लिए लॉगिन करें', user_menu: 'प्रोफ़ाइल',
        username: 'उपयोगकर्ता नाम', password: 'पासवर्ड', sign_in: 'साइन इन करें',
        sign_in_error: 'प्रमाणीकरण विफल, कृपया पुनः प्रयास करें', logout: 'लॉग आउट',
      },
      notification: {
        updated: 'तत्व अपडेट किया गया |||| %{smart_count} तत्व अपडेट किए गए',
        created: 'तत्व बनाया गया', deleted: 'तत्व हटाया गया |||| %{smart_count} तत्व हटाए गए',
        bad_item: 'गलत तत्व', item_doesnt_exist: 'तत्व मौजूद नहीं है',
        http_error: 'सर्वर संचार त्रुटि',
        data_provider_error: 'dataProvider त्रुटि। विवरण के लिए कंसोल देखें।',
        canceled: 'कार्रवाई रद्द की गई', logged_out: 'आपका सत्र समाप्त हो गया है, कृपया पुनः कनेक्ट करें।',
      },
      validation: {
        required: 'आवश्यक', minLength: 'कम से कम %{min} अक्षर होने चाहिए',
        maxLength: '%{max} अक्षर या उससे कम होने चाहिए', minValue: 'कम से कम %{min} होना चाहिए',
        maxValue: '%{max} या उससे कम होना चाहिए', number: 'एक संख्या होनी चाहिए',
        email: 'मान्य ईमेल होना चाहिए', oneOf: 'इनमें से एक होना चाहिए: %{options}',
        regex: 'एक विशिष्ट प्रारूप से मेल खाना चाहिए (regexp): %{pattern}',
      },
      message: {
        about: 'के बारे में', are_you_sure: 'क्या आप निश्चित हैं?',
        bulk_delete_content: 'क्या आप वाकई इस %{name} को हटाना चाहते हैं? |||| क्या आप वाकई इन %{smart_count} आइटम को हटाना चाहते हैं?',
        bulk_delete_title: '%{name} हटाएं |||| %{smart_count} %{name} हटाएं',
        delete_content: 'क्या आप वाकई इस %{name} को हटाना चाहते हैं?',
        delete_title: '%{name} %{recordRepresentation} हटाएं', details: 'विवरण',
        error: 'क्लाइंट त्रुटि हुई और आपका अनुरोध पूरा नहीं हो सका।',
        invalid_form: 'फ़ॉर्म मान्य नहीं है। कृपया त्रुटियों की जाँच करें',
        loading: 'कृपया प्रतीक्षा करें', no: 'नहीं',
        not_found: 'आपने गलत URL टाइप किया, या आपने एक खराब लिंक का अनुसरण किया।',
        unsaved_changes: 'आपके कुछ परिवर्तन सहेजे नहीं गए। क्या आप वाकई उन्हें अनदेखा करना चाहते हैं?',
        yes: 'हाँ',
      },
      saved_queries: {
        label: 'सहेजी गई क्वेरी', query_name: 'क्वेरी नाम', new_label: 'वर्तमान क्वेरी सहेजें...',
        new_dialog_title: 'वर्तमान क्वेरी इस रूप में सहेजें', remove_label: 'सहेजी गई क्वेरी हटाएं',
        remove_dialog_title: 'सहेजी गई क्वेरी हटाएं?',
        remove_message: 'क्या आप वाकई इस आइटम को अपनी सहेजी गई क्वेरी की सूची से हटाना चाहते हैं?',
        help: 'सूची फ़िल्टर करें और इस क्वेरी को बाद के लिए सहेजें',
      },
    },
  },
  pt_BR: {
    ra: {
      action: {
        add_filter: 'Adicionar filtro', add: 'Adicionar', back: 'Voltar',
        bulk_actions: '1 item selecionado |||| %{smart_count} itens selecionados',
        cancel: 'Cancelar', clear_array_input: 'Limpar lista', clear_input_value: 'Limpar valor',
        clone: 'Clonar', confirm: 'Confirmar', create: 'Criar', create_item: 'Criar %{item}',
        delete: 'Excluir', edit: 'Editar', export: 'Exportar', list: 'Lista',
        refresh: 'Atualizar', remove_filter: 'Remover este filtro', remove_all_filters: 'Remover todos os filtros',
        remove: 'Remover', reset: 'Redefinir', save: 'Salvar', search: 'Pesquisar',
        select_all: 'Selecionar tudo', select_row: 'Selecionar esta linha', show: 'Exibir',
        sort: 'Ordenar', undo: 'Desfazer', unselect: 'Desmarcar',
        expand: 'Expandir', close: 'Fechar', open_menu: 'Abrir menu', close_menu: 'Fechar menu',
        update: 'Atualizar', open: 'Abrir', toggle_theme: 'Alternar modo claro/escuro', select_columns: 'Colunas',
      },
      boolean: { true: 'Sim', false: 'Não', null: ' ' },
      page: {
        create: 'Criar %{name}', dashboard: 'Painel', edit: '%{name} %{recordRepresentation}',
        error: 'Algo deu errado', list: '%{name}', loading: 'Carregando', not_found: 'Não encontrado',
        show: '%{name} %{recordRepresentation}', empty: 'Nenhum %{name} ainda.',
        invite: 'Deseja adicionar um?',
      },
      navigation: {
        clear_filters: 'Limpar filtros',
        no_filtered_results: 'Nenhum %{name} encontrado com os filtros atuais.',
        no_results: 'Nenhum %{name} encontrado',
        no_more_results: 'A página %{page} está fora dos limites.',
        page_out_of_boundaries: 'Página %{page} fora dos limites',
        page_out_from_end: 'Não é possível ir além da última página',
        page_out_from_begin: 'Não é possível ir antes da página 1',
        page_range_info: '%{offsetBegin}-%{offsetEnd} de %{total}',
        partial_page_range_info: '%{offsetBegin}-%{offsetEnd} de mais de %{offsetEnd}',
        current_page: 'Página %{page}', page: 'Ir para a página %{page}',
        first: 'Ir para a primeira página', last: 'Ir para a última página',
        next: 'Ir para a próxima página', previous: 'Ir para a página anterior',
        page_rows_per_page: 'Linhas por página:', skip_nav: 'Ir para o conteúdo',
      },
      sort: { sort_by: 'Ordenar por %{field_lower_first} %{order}', ASC: 'Crescente', DESC: 'Decrescente' },
      auth: {
        auth_check_error: 'Por favor, faça login para continuar', user_menu: 'Perfil',
        username: 'Usuário', password: 'Senha', sign_in: 'Entrar',
        sign_in_error: 'Falha na autenticação, tente novamente', logout: 'Sair',
      },
      notification: {
        updated: 'Elemento atualizado |||| %{smart_count} elementos atualizados',
        created: 'Elemento criado', deleted: 'Elemento excluído |||| %{smart_count} elementos excluídos',
        bad_item: 'Elemento incorreto', item_doesnt_exist: 'O elemento não existe',
        http_error: 'Erro de comunicação com o servidor',
        data_provider_error: 'Erro do dataProvider. Consulte o console para detalhes.',
        canceled: 'Ação cancelada', logged_out: 'Sua sessão expirou, por favor reconecte.',
      },
      validation: {
        required: 'Obrigatório', minLength: 'Deve ter no mínimo %{min} caracteres',
        maxLength: 'Deve ter no máximo %{max} caracteres', minValue: 'Deve ser no mínimo %{min}',
        maxValue: 'Deve ser no máximo %{max}', number: 'Deve ser um número',
        email: 'Deve ser um e-mail válido', oneOf: 'Deve ser um dos seguintes: %{options}',
        regex: 'Deve corresponder ao formato (regexp): %{pattern}',
      },
      message: {
        about: 'Sobre', are_you_sure: 'Tem certeza?',
        bulk_delete_content: 'Tem certeza de que deseja excluir este %{name}? |||| Tem certeza de que deseja excluir estes %{smart_count} itens?',
        bulk_delete_title: 'Excluir %{name} |||| Excluir %{smart_count} %{name}',
        delete_content: 'Tem certeza de que deseja excluir este %{name}?',
        delete_title: 'Excluir %{name} %{recordRepresentation}', details: 'Detalhes',
        error: 'Ocorreu um erro no cliente e sua solicitação não pôde ser concluída.',
        invalid_form: 'O formulário não é válido. Verifique os erros',
        loading: 'Por favor, aguarde', no: 'Não',
        not_found: 'Você digitou uma URL incorreta ou seguiu um link inválido.',
        unsaved_changes: 'Algumas alterações não foram salvas. Deseja ignorá-las?', yes: 'Sim',
      },
      saved_queries: {
        label: 'Consultas salvas', query_name: 'Nome da consulta', new_label: 'Salvar consulta atual...',
        new_dialog_title: 'Salvar consulta atual como', remove_label: 'Remover consulta salva',
        remove_dialog_title: 'Remover consulta salva?',
        remove_message: 'Tem certeza de que deseja remover este item da lista de consultas salvas?',
        help: 'Filtre a lista e salve esta consulta para depois',
      },
    },
  },
  fr_FR: {
    ra: {
      action: {
        add_filter: 'Ajouter un filtre', add: 'Ajouter', back: 'Retour',
        bulk_actions: '1 élément sélectionné |||| %{smart_count} éléments sélectionnés',
        cancel: 'Annuler', clear_array_input: 'Vider la liste', clear_input_value: 'Effacer la valeur',
        clone: 'Dupliquer', confirm: 'Confirmer', create: 'Créer', create_item: 'Créer %{item}',
        delete: 'Supprimer', edit: 'Modifier', export: 'Exporter', list: 'Liste',
        refresh: 'Actualiser', remove_filter: 'Supprimer ce filtre', remove_all_filters: 'Supprimer tous les filtres',
        remove: 'Supprimer', reset: 'Réinitialiser', save: 'Enregistrer', search: 'Rechercher',
        select_all: 'Tout sélectionner', select_row: 'Sélectionner cette ligne', show: 'Afficher',
        sort: 'Trier', undo: 'Annuler', unselect: 'Désélectionner',
        expand: 'Développer', close: 'Fermer', open_menu: 'Ouvrir le menu', close_menu: 'Fermer le menu',
        update: 'Mettre à jour', open: 'Ouvrir', toggle_theme: 'Basculer mode clair/sombre', select_columns: 'Colonnes',
      },
      boolean: { true: 'Oui', false: 'Non', null: ' ' },
      page: {
        create: 'Créer %{name}', dashboard: 'Tableau de bord', edit: '%{name} %{recordRepresentation}',
        error: 'Une erreur est survenue', list: '%{name}', loading: 'Chargement', not_found: 'Introuvable',
        show: '%{name} %{recordRepresentation}', empty: 'Aucun %{name} pour le moment.',
        invite: 'Voulez-vous en ajouter un ?',
      },
      navigation: {
        clear_filters: 'Effacer les filtres',
        no_filtered_results: 'Aucun %{name} trouvé avec les filtres actuels.',
        no_results: 'Aucun %{name} trouvé',
        no_more_results: 'La page %{page} est hors limites.',
        page_out_of_boundaries: 'Page %{page} hors limites',
        page_out_from_end: 'Impossible d\'aller au-delà de la dernière page',
        page_out_from_begin: 'Impossible d\'aller avant la page 1',
        page_range_info: '%{offsetBegin}-%{offsetEnd} sur %{total}',
        partial_page_range_info: '%{offsetBegin}-%{offsetEnd} sur plus de %{offsetEnd}',
        current_page: 'Page %{page}', page: 'Aller à la page %{page}',
        first: 'Aller à la première page', last: 'Aller à la dernière page',
        next: 'Aller à la page suivante', previous: 'Aller à la page précédente',
        page_rows_per_page: 'Lignes par page :', skip_nav: 'Aller au contenu',
      },
      sort: { sort_by: 'Trier par %{field_lower_first} %{order}', ASC: 'Croissant', DESC: 'Décroissant' },
      auth: {
        auth_check_error: 'Veuillez vous connecter pour continuer', user_menu: 'Profil',
        username: 'Nom d\'utilisateur', password: 'Mot de passe', sign_in: 'Se connecter',
        sign_in_error: 'Échec de l\'authentification, veuillez réessayer', logout: 'Déconnexion',
      },
      notification: {
        updated: 'Élément mis à jour |||| %{smart_count} éléments mis à jour',
        created: 'Élément créé', deleted: 'Élément supprimé |||| %{smart_count} éléments supprimés',
        bad_item: 'Élément incorrect', item_doesnt_exist: 'L\'élément n\'existe pas',
        http_error: 'Erreur de communication avec le serveur',
        data_provider_error: 'Erreur du dataProvider. Consultez la console pour les détails.',
        canceled: 'Action annulée', logged_out: 'Votre session a expiré, veuillez vous reconnecter.',
      },
      validation: {
        required: 'Obligatoire', minLength: 'Doit contenir au moins %{min} caractères',
        maxLength: 'Doit contenir au maximum %{max} caractères', minValue: 'Doit être au minimum %{min}',
        maxValue: 'Doit être au maximum %{max}', number: 'Doit être un nombre',
        email: 'Doit être une adresse e-mail valide', oneOf: 'Doit être l\'un des suivants : %{options}',
        regex: 'Doit correspondre au format (regexp) : %{pattern}',
      },
      message: {
        about: 'À propos', are_you_sure: 'Êtes-vous sûr ?',
        bulk_delete_content: 'Êtes-vous sûr de vouloir supprimer ce %{name} ? |||| Êtes-vous sûr de vouloir supprimer ces %{smart_count} éléments ?',
        bulk_delete_title: 'Supprimer %{name} |||| Supprimer %{smart_count} %{name}',
        delete_content: 'Êtes-vous sûr de vouloir supprimer ce %{name} ?',
        delete_title: 'Supprimer %{name} %{recordRepresentation}', details: 'Détails',
        error: 'Une erreur côté client est survenue et votre requête n\'a pas pu être complétée.',
        invalid_form: 'Le formulaire n\'est pas valide. Veuillez vérifier les erreurs',
        loading: 'Veuillez patienter', no: 'Non',
        not_found: 'Vous avez saisi une URL incorrecte ou suivi un lien invalide.',
        unsaved_changes: 'Certaines modifications n\'ont pas été enregistrées. Voulez-vous les ignorer ?', yes: 'Oui',
      },
      saved_queries: {
        label: 'Requêtes enregistrées', query_name: 'Nom de la requête', new_label: 'Enregistrer la requête actuelle...',
        new_dialog_title: 'Enregistrer la requête actuelle sous', remove_label: 'Supprimer la requête enregistrée',
        remove_dialog_title: 'Supprimer la requête enregistrée ?',
        remove_message: 'Êtes-vous sûr de vouloir supprimer cet élément de votre liste de requêtes enregistrées ?',
        help: 'Filtrez la liste et enregistrez cette requête pour plus tard',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand "app.nav.dashboard" → { app: { nav: { dashboard: "..." } } } */
function dotToNested(flat: Record<string, string>): TranslationMessages {
  const result: Record<string, unknown> = {};
  for (const [dotKey, value] of Object.entries(flat)) {
    const parts = dotKey.split('.');
    let current: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
  return result as TranslationMessages;
}

/** Deep merge source into target (target is mutated). */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ---------------------------------------------------------------------------
// Translation cache — in-memory + localStorage with 1-day TTL
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const CACHE_KEY_PREFIX = 'digit-i18n-';

const memoryCache = new Map<string, TranslationMessages>();

/** Read cached translations from localStorage (returns null if expired/missing). */
function readLocalStorageCache(locale: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + locale);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; data: Record<string, string> };
    if (Date.now() - parsed.ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY_PREFIX + locale);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

/** Write translations to localStorage with timestamp. */
function writeLocalStorageCache(locale: string, data: Record<string, string>): void {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + locale, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

export function clearTranslationCache(): void {
  memoryCache.clear();
  for (const { locale } of AVAILABLE_LOCALES) {
    try { localStorage.removeItem(CACHE_KEY_PREFIX + locale); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Fetch app.* translations from DIGIT localization API (with localStorage cache)
// ---------------------------------------------------------------------------
async function fetchAppTranslations(locale: string): Promise<Record<string, string>> {
  // Check localStorage first (survives page reloads, 1-day TTL)
  const cached = readLocalStorageCache(locale);
  if (cached) return cached;

  try {
    const tenantId = digitClient.stateTenantId || 'pg';
    const messages = await digitClient.localizationSearch(tenantId, locale, 'configurator-ui');
    const flat: Record<string, string> = {};
    for (const msg of messages) {
      const code = msg.code as string | undefined;
      const text = msg.message as string | undefined;
      if (code && text) flat[code] = text;
    }
    if (Object.keys(flat).length > 0) {
      writeLocalStorageCache(locale, flat);
    }
    return flat;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Get messages for a locale
// ---------------------------------------------------------------------------
async function getMessagesAsync(locale: string): Promise<TranslationMessages> {
  const cached = memoryCache.get(locale);
  if (cached) return cached;

  // Start with English app.* as fallback base
  const base = JSON.parse(JSON.stringify(customEnglishMessages)) as Record<string, unknown>;

  // Overlay ra.* framework strings for this locale (bundled)
  const raBundle = RA_BUNDLES[locale];
  if (raBundle) {
    deepMerge(base, raBundle);
  }

  // Fetch app.* translations from DIGIT API (source of truth)
  const apiTranslations = await fetchAppTranslations(locale);
  if (Object.keys(apiTranslations).length > 0) {
    const nested = dotToNested(apiTranslations);
    deepMerge(base, nested);
  }

  const result = base as TranslationMessages;
  memoryCache.set(locale, result);
  return result;
}

function getMessages(locale: string): TranslationMessages | Promise<TranslationMessages> {
  // Default locale (en_IN) must return synchronously for polyglot init
  if (locale === 'en_IN' || locale === 'en') {
    return customEnglishMessages;
  }
  return getMessagesAsync(locale);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export const i18nProvider = polyglotI18nProvider(
  getMessages,
  'en_IN',
  AVAILABLE_LOCALES,
  { allowMissing: true },
);
