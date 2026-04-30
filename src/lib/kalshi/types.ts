export type KalshiEnv = "demo" | "prod";

export interface KalshiCredentials {
  keyId: string;
  privateKeyPem: string;
  env: KalshiEnv;
  /** Optional CORS proxy prefix, e.g. "https://corsproxy.io/?". Empty = direct fetch. */
  corsProxy: string;
}

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle?: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  open_interest: number;
  status: string;
  close_time: string;
  expiration_time: string;
  floor_strike?: number;
  cap_strike?: number;
  strike_type?: string;
}

export interface KalshiOrderbook {
  yes: Array<[number, number]>;
  no: Array<[number, number]>;
}

export interface KalshiPosition {
  ticker: string;
  position: number;
  market_exposure: number;
  realized_pnl: number;
  total_traded: number;
  resting_orders_count: number;
}

export interface KalshiOrder {
  order_id: string;
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  type: "limit" | "market";
  yes_price?: number;
  no_price?: number;
  count: number;
  status: string;
  created_time: string;
}

export interface KalshiFill {
  trade_id: string;
  order_id: string;
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  yes_price: number;
  no_price: number;
  created_time: string;
  is_taker: boolean;
}

export interface KalshiBalance {
  balance: number;
  payout: number;
}