import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { robinhood } from "./chain";

export const config = createConfig({
  chains: [robinhood],
  connectors: [injected()],
  transports: { [robinhood.id]: http() },
  ssr: true,
});
