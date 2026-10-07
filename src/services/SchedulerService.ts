import { childLogger } from '../utils/logger';
import { SCHEDULER_INTERVAL_MS } from '../config/constants';

const log = childLogger('Scheduler');

export interface ScheduledTask {
  name: string;
  /** Intervalle en ms entre deux exécutions */
  intervalMs: number;
  run(): Promise<void>;
  /** Exécuter immédiatement au démarrage */
  runOnStart?: boolean;
}

/**
 * Ordonnanceur centralisé : chaque service enregistre une tâche périodique
 * (annonces programmées, fin de giveaways, rappels d'événements, tempbans…).
 * Une seule boucle, pas de setInterval disséminés.
 */
export class SchedulerService {
  private readonly tasks = new Map<string, ScheduledTask & { nextRun: number; running: boolean }>();
  private timer: NodeJS.Timeout | null = null;
  private tickMs = 0;

  register(task: ScheduledTask): void {
    if (this.tasks.has(task.name)) throw new Error(`Tâche déjà enregistrée : ${task.name}`);
    this.tasks.set(task.name, { ...task, nextRun: task.runOnStart ? 0 : Date.now() + task.intervalMs, running: false });
    log.debug({ task: task.name, intervalMs: task.intervalMs }, 'Tâche enregistrée');
    // Tâche plus fréquente que la boucle en cours (ex. envoi des logs toutes les 2 s) : la boucle accélère.
    if (this.timer && tickFor(this.tickMs, task.intervalMs) < this.tickMs) this.restart(task.intervalMs);
  }

  unregister(name: string): void {
    this.tasks.delete(name);
  }

  start(tickMs = SCHEDULER_INTERVAL_MS): void {
    if (this.timer) return;
    const shortest = Math.min(...[...this.tasks.values()].map((t) => t.intervalMs), tickMs);
    this.tickMs = tickFor(tickMs, shortest);
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
    void this.tick();
    log.info({ tasks: [...this.tasks.keys()], tickMs: this.tickMs }, 'Scheduler démarré');
  }

  private restart(shortest: number): void {
    if (this.timer) clearInterval(this.timer);
    this.tickMs = tickFor(this.tickMs, shortest);
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  /** Période de la boucle (0 = arrêtée). */
  get tickInterval(): number {
    return this.timer ? this.tickMs : 0;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Force l'exécution d'une tâche (tests / dashboard). */
  async runNow(name: string): Promise<void> {
    const task = this.tasks.get(name);
    if (!task) throw new Error(`Tâche inconnue : ${name}`);
    await this.execute(task);
  }

  async tick(now = Date.now()): Promise<void> {
    for (const task of this.tasks.values()) {
      if (task.running || task.nextRun > now) continue;
      void this.execute(task);
    }
  }

  private async execute(task: ScheduledTask & { nextRun: number; running: boolean }): Promise<void> {
    task.running = true;
    const started = Date.now();
    try {
      await task.run();
    } catch (err) {
      log.error({ err, task: task.name }, 'Tâche planifiée en erreur');
    } finally {
      task.running = false;
      task.nextRun = Date.now() + task.intervalMs;
      const took = Date.now() - started;
      if (took > 5000) log.warn({ task: task.name, took }, 'Tâche lente');
    }
  }

  get registered(): string[] {
    return [...this.tasks.keys()];
  }
}

/** Période de la boucle : ≤ 5 s, ramenée à la tâche la plus fréquente, jamais sous 1 s. */
export function tickFor(current: number, intervalMs: number): number {
  return Math.max(1000, Math.min(current || 5000, 5000, intervalMs));
}

export const scheduler = new SchedulerService();
