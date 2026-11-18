const CONSENT_VERSION = '1.0';
const BLOCKED_MESSAGE = 'Aceite de primeiro acesso necessario.';

const DEFAULT_PERMISSIONS = {
  backgroundExecution: false,
  launchAppsAndLinks: false,
  pythonAutomation: false
};

const SCOPE_MAP = {
  backgroundExecution: 'backgroundExecution',
  background: 'backgroundExecution',
  startup: 'backgroundExecution',
  launchAppsAndLinks: 'launchAppsAndLinks',
  launch: 'launchAppsAndLinks',
  apps: 'launchAppsAndLinks',
  links: 'launchAppsAndLinks',
  pythonAutomation: 'pythonAutomation',
  python: 'pythonAutomation',
  autoScripts: 'pythonAutomation'
};

function normalizePermissions(rawPermissions, accepted) {
  const src = rawPermissions && typeof rawPermissions === 'object' ? rawPermissions : {};
  if (!accepted) {
    return Object.assign({}, DEFAULT_PERMISSIONS);
  }
  return {
    backgroundExecution: src.backgroundExecution !== false,
    launchAppsAndLinks: src.launchAppsAndLinks !== false,
    pythonAutomation: src.pythonAutomation !== false
  };
}

function normalizeConsentRecord(rawConsent) {
  const src = rawConsent && typeof rawConsent === 'object' ? rawConsent : {};
  const accepted = src.accepted === true;
  return {
    accepted,
    decidedAt: src.decidedAt || null,
    version: typeof src.version === 'string' && src.version ? src.version : CONSENT_VERSION,
    permissions: normalizePermissions(src.permissions, accepted)
  };
}

class ConsentManager {
  constructor(configManager) {
    this.configManager = configManager;
  }

  getConsentStatus() {
    const cfg = this.configManager && typeof this.configManager.get === 'function'
      ? this.configManager.get()
      : null;
    return normalizeConsentRecord(cfg && cfg.consent);
  }

  getStatus() {
    return this.getConsentStatus();
  }

  isAccepted() {
    return Boolean(this.getConsentStatus().accepted);
  }

  setConsentDecision(accepted, permissions = {}) {
    if (this.configManager && typeof this.configManager.get === 'function') {
      this.configManager.get();
    }
    const isAccepted = Boolean(accepted);
    const nextConsent = {
      accepted: isAccepted,
      decidedAt: new Date().toISOString(),
      version: CONSENT_VERSION,
      permissions: normalizePermissions(permissions, isAccepted)
    };

    if (this.configManager && typeof this.configManager.save === 'function') {
      this.configManager.save({ consent: nextConsent });
    }

    return {
      ok: true,
      consent: this.getConsentStatus()
    };
  }

  setDecision(accepted, permissions = {}) {
    return this.setConsentDecision(accepted, permissions);
  }

  isActionAllowed(scope) {
    const status = this.getConsentStatus();
    if (!status.accepted) {
      return false;
    }
    if (!scope) {
      return true;
    }
    const mapped = SCOPE_MAP[String(scope).trim()];
    if (mapped) {
      return status.permissions[mapped] === true;
    }
    return true;
  }

  gateResult() {
    return {
      ok: false,
      blockedByConsent: true,
      message: BLOCKED_MESSAGE
    };
  }

  getBlockedResponse() {
    return this.gateResult();
  }
}

ConsentManager.CONSENT_VERSION = CONSENT_VERSION;
ConsentManager.BLOCKED_MESSAGE = BLOCKED_MESSAGE;

module.exports = ConsentManager;
