/** Erreur HTTP transportant un statut et un message affichable (jamais de stack côté client). */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: string[];
  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const STATUS_TITLES: Record<number, string> = {
  400: 'Requête invalide',
  401: 'Connexion requise',
  403: 'Accès refusé',
  404: 'Page introuvable',
  409: 'Conflit',
  429: 'Trop de requêtes',
  500: 'Erreur interne',
  503: 'Service indisponible',
};

export function statusTitle(status: number): string {
  return STATUS_TITLES[status] ?? (status >= 500 ? 'Erreur serveur' : 'Erreur');
}
