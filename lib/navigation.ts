export type DashboardView="Explore"|"My coins"|"Agents";
export function dashboardView(value:unknown):DashboardView{return value==="agents"?"Agents":value==="my-coins"?"My coins":"Explore";}
export function dashboardHref(view:DashboardView){return view==="Explore"?"/":view==="Agents"?"/?view=agents":"/?view=my-coins";}
