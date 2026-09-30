import type { Draft, Params, Cost } from './types.ts';
export interface ReplicaSegment {id:string;draft:Draft;issue?:string;cost?:Cost;variants?:Record<string,{params:Params;accountId:string}>}
export interface ReplicaSession {id:string;name:string;revision:number;confirmed:boolean;fingerprint?:string;state:'ready'|'submitted'|'blocked';segments:ReplicaSegment[];taskIds:string[]}
