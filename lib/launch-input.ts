import {z} from "zod";
const social=z.union([z.literal(""),z.string().url().max(250).refine(v=>v.startsWith("https://"),"Use an HTTPS URL.")]);
// Economic parameters are intentionally absent; strict parsing rejects attempts to override them.
export const launchInput=z.object({name:z.string().trim().min(1).max(32),symbol:z.string().regex(/^[A-Z0-9]{2,10}$/),description:z.string().trim().min(1).max(1000),website:social,twitter:social,telegram:social,model:z.enum(["fable","astra","opus-5-5","gpt-sol-latest"]),quoteMint:z.string().min(32).max(44),devBuyAmount:z.string().trim().max(40).regex(/^(?:\d+(?:\.\d+)?)?$/,'Enter a valid dev buy amount.').default('')}).strict();
