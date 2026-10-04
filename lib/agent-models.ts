// Verified against https://openrouter.ai/api/v1/models on 2026-10-05.
// Pin concrete versions: neither creators nor environment values may reroute them.
export const AGENT_MODELS=[
 {id:"fable",name:"Fable",openrouterId:"anthropic/claude-fable-5.1"},
 {id:"astra",name:"Astra",openrouterId:"openai/gpt-6-astra"},
 {id:"opus-5-5",name:"Opus 5.5",openrouterId:"anthropic/claude-opus-5.5"},
 {id:"gpt-sol-latest",name:"GPT Sol 6.1",openrouterId:"openai/gpt-6.1-sol"},
] as const;
export type AgentModelId=typeof AGENT_MODELS[number]["id"];
export function modelDefinition(id:string){const model=AGENT_MODELS.find(m=>m.id===id);if(!model)throw new Error("Choose Fable, Astra, Opus 5.5, or GPT Sol 6.1.");return model;}
