/**
 * A capability whose provider is not configured in this environment. Carries the configuration
 * variable to set, so the failure is actionable (ADR-0012), and never a value.
 */
export class ServiceNotConfiguredError extends Error {
  readonly code = 'SERVICE_NOT_CONFIGURED';

  constructor(
    readonly service: string,
    readonly variable: string,
  ) {
    super(`${service} is not configured. Set ${variable}; see docs/architecture/environments.md.`);
    this.name = 'ServiceNotConfiguredError';
  }
}
