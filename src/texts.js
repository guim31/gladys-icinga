// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// messages. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
//
// The states (UP, DOWN, UNREACHABLE, OK, WARNING, CRITICAL, UNKNOWN) stay
// the words of Icinga: Icinga Web does not translate them either.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './icinga/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your Icinga 2 and an API user in the configuration.',
    fr: "Saisissez l'adresse de votre Icinga 2 et un utilisateur d'API dans la configuration.",
    de: 'Gib die Adresse deines Icinga 2 und einen API-Benutzer in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Icinga 2 y un usuario de API en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. 192.168.1.2 or https://icinga.lan:5665',
    fr: 'Adresse incomprise, ex. 192.168.1.2 ou https://icinga.lan:5665',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.2 oder https://icinga.lan:5665',
    es: 'Dirección no válida, p. ej. 192.168.1.2 o https://icinga.lan:5665',
  },
};

// One short explanation per error kind (src/icinga/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Icinga does not answer',
    fr: 'Icinga ne répond pas',
    de: 'Icinga antwortet nicht',
    es: 'Icinga no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API user or password refused',
    fr: "utilisateur d'API ou mot de passe refusé",
    de: 'API-Benutzer oder Passwort abgelehnt',
    es: 'usuario de API o contraseña rechazados',
  },
  [ERROR_KINDS.CREDENTIALS_MISSING]: {
    en: 'an API user and its password are needed',
    fr: "un utilisateur d'API et son mot de passe sont nécessaires",
    de: 'ein API-Benutzer und sein Passwort sind nötig',
    es: 'se necesitan un usuario de API y su contraseña',
  },
  [ERROR_KINDS.NOT_ICINGA]: {
    en: 'no Icinga 2 API at this address: check the port (5665)',
    fr: "pas d'API Icinga 2 à cette adresse : vérifiez le port (5665)",
    de: 'keine Icinga-2-API unter dieser Adresse: Prüfe den Port (5665)',
    es: 'no hay ninguna API de Icinga 2 en esta dirección: compruebe el puerto (5665)',
  },
  [ERROR_KINDS.HTTPS_REQUIRED]: {
    en: 'the Icinga API only speaks HTTPS: enter https://',
    fr: "l'API d'Icinga ne parle que HTTPS : saisissez https://",
    de: 'die Icinga-API spricht nur HTTPS: Gib https:// ein',
    es: 'la API de Icinga solo habla HTTPS: introduzca https://',
  },
  [ERROR_KINDS.NO_HOSTS]: {
    en: 'no host visible: give the API user objects/query/Host',
    fr: "aucun hôte visible : donnez objects/query/Host à l'utilisateur d'API",
    de: 'kein Host sichtbar: Gib dem API-Benutzer objects/query/Host',
    es: 'ningún host visible: conceda objects/query/Host al usuario de API',
  },
  [ERROR_KINDS.PERMISSION]: {
    en: 'permission missing for the API user, see the documentation',
    fr: "permission manquante pour l'utilisateur d'API, voir la documentation",
    de: 'Berechtigung des API-Benutzers fehlt, sieh in der Dokumentation nach',
    es: 'falta un permiso del usuario de API, consulte la documentación',
  },
  [ERROR_KINDS.API]: {
    en: 'request refused by Icinga, see the logs',
    fr: 'requête refusée par Icinga, voir les logs',
    de: 'Anfrage von Icinga abgelehnt, sieh in den Protokollen nach',
    es: 'petición rechazada por Icinga, consulte los registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

export const HOST_STATE_NAMES = ['UP', 'DOWN', 'UNREACHABLE'];
export const SERVICE_STATE_NAMES = ['OK', 'WARNING', 'CRITICAL', 'UNKNOWN'];

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    hosts: (count, total) => (count === total ? `${count} host(s)` : `${count}/${total} host(s)`),
    problems: (down, services) => `${down} host(s) down, ${services} service problem(s)`,
  },
  fr: {
    ok: 'OK',
    hosts: (count, total) => (count === total ? `${count} hôte(s)` : `${count}/${total} hôte(s)`),
    problems: (down, services) => `${down} hôte(s) DOWN, ${services} service(s) en problème`,
  },
  de: {
    ok: 'OK',
    hosts: (count, total) => (count === total ? `${count} Host(s)` : `${count}/${total} Host(s)`),
    problems: (down, services) => `${down} Host(s) DOWN, ${services} Service-Problem(e)`,
  },
  es: {
    ok: 'OK',
    hosts: (count, total) => (count === total ? `${count} host(s)` : `${count}/${total} host(s)`),
    problems: (down, services) => `${down} host(s) DOWN, ${services} servicio(s) con problemas`,
  },
};

// Scene action messages (shown in Gladys).
export const ACTION_TEXT = {
  noServer: {
    en: 'No Icinga is configured.',
    fr: "Aucun Icinga n'est configuré.",
    de: 'Kein Icinga ist konfiguriert.',
    es: 'No hay ningún Icinga configurado.',
  },
  unknownHost: {
    en: 'This device is not an Icinga host.',
    fr: "Cet appareil n'est pas un hôte Icinga.",
    de: 'Dieses Gerät ist kein Icinga-Host.',
    es: 'Este dispositivo no es un host de Icinga.',
  },
  acknowledgeDisabled: {
    en: 'Acknowledging is turned off in the configuration of the integration.',
    fr: "L'acquittement est désactivé dans la configuration de l'intégration.",
    de: 'Das Quittieren ist in der Konfiguration der Integration ausgeschaltet.',
    es: 'El reconocimiento está desactivado en la configuración de la integración.',
  },
  acknowledgeRefused: {
    en: 'Icinga refused to acknowledge: give the API user the actions/acknowledge-problem permission.',
    fr: "Icinga a refusé l'acquittement : donnez la permission actions/acknowledge-problem à l'utilisateur d'API.",
    de: 'Icinga hat das Quittieren abgelehnt: Gib dem API-Benutzer die Berechtigung actions/acknowledge-problem.',
    es: 'Icinga rechazó el reconocimiento: conceda el permiso actions/acknowledge-problem al usuario de API.',
  },
  defaultComment: {
    en: 'Acknowledged from Gladys',
    fr: 'Acquitté depuis Gladys',
    de: 'In Gladys quittiert',
    es: 'Reconocido desde Gladys',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
