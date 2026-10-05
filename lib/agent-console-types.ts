export type ConsoleEvent={id:string;at:number;kind:string;message:string;signature?:string|null};
export type AgentConsoleData={
 observedAt:number;model:string;activated:boolean;paused:boolean;phase:'bonding'|'graduated';
 lastWorkerAt:number|null;lastDecisionAt:number|null;running:boolean;
 budget:{mode:'paused'|'economy'|'continuous';earnedUsd:number;spentUsd:number;committedUsd:number;remainingUsd:number;callCount:number};
 market:{lastObservedAt:number|null;lastIndexedAt:number|null;observations:number;trades:number;depthUsd:number|null};
 jobs:{id:string;kind:string;status:string;message:string|null}[];
 funding:{checkedAt:number|null;message:string;deposits:number;pendingDeposits:number;lastDepositAt:number|null;signature:string|null};
 events:ConsoleEvent[];
};
