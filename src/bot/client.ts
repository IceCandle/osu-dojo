import BanchoJs from 'bancho.js';

/**
 * Simplified wrapper around BanchoClient
 * Bancho.js already handles:
 * - Auto-reconnection with exponential backoff
 * - Message queue with rate limiting
 * - PING/PONG keep-alive
 */
export class BotClient {
  private client: BanchoJs.BanchoClient;

  constructor(username: string, password: string, apiKey?: string) {
    this.client = new BanchoJs.BanchoClient({
      username,
      password,
      apiKey, // Optional: increases rate limits if you have osu! API key
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.client.on('connected', () => {
      console.log('✓ Connected to Bancho IRC');
    });

    this.client.on('disconnected', () => {
      console.log('✗ Disconnected from Bancho IRC');
    });

    this.client.on('error', (error: Error) => {
      console.error('IRC Error:', error.message);
    });

    // Note: Bancho.js automatically reconnects on disconnect
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * Create a new multiplayer lobby
   * @param name Lobby name
   * @returns BanchoLobby channel
   */
  async createLobby(name: string) {
    return await this.client.createLobby(name);
  }

  /**
   * Join an existing multiplayer lobby by ID
   * @param mpId Multiplayer room ID
   */
  async joinLobby(mpId: string) {
    const channel = this.client.getChannel(`#mp_${mpId}`);
    await channel.join();
    return channel;
  }

  getClient(): BanchoJs.BanchoClient {
    return this.client;
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }
}
