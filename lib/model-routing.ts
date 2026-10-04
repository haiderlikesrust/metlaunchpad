import {HttpError} from "./server";
import {AGENT_MODELS,modelDefinition} from "./agent-models";
export function publicModelOptions(){return AGENT_MODELS.map(m=>({id:m.id,name:m.name,openrouterId:m.openrouterId,configured:true}));}
export function resolveAgentModel(id:string){
 let definition;try{definition=modelDefinition(id);}catch{throw new HttpError(400,"Choose one of the four supported agents.");}
 return definition.openrouterId;
}
