export const departments={graphics:"Graphics",development:"Development",communications:"Communications",events:"Events",marketing:"Marketing"};
export type Assignment="staff"|"hod";
export type StaffRow={id:string;name:string;email:string;role:"ceo"|"admin"|Assignment;status:"active"|"inactive";version:number;departments:string[];account_status:string;hub_access:boolean};
export type InviteRow={id:string;name:string;email:string;role:Assignment;department:string;status:string;expires_at:string;account_status?:string};
export type AccessData={members:StaffRow[];invitations:InviteRow[];audit:{id:number;action:string;actor:string;target:string;created_at:string}[];truncated:boolean};
export function companyEmail(value:unknown){
 const email=typeof value==="string"?value.trim().toLowerCase():"";
 if(email.length>254||! /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@enibrand\.com$/.test(email))throw Error("Use an existing @enibrand.com email address.");
 return email;
}
export function assignment(value:Record<string,unknown>){
 const name=typeof value.name==="string"?value.name.trim():"";
 if(!name||name.length>120)throw Error("Enter a name of 1–120 characters.");
 if(value.role!=="staff"&&value.role!=="hod")throw Error("Only Employee and HOD assignments are permitted.");
 const values=Array.isArray(value.departments)?value.departments:typeof value.department==="string"?[value.department]:[];
 if(!values.length||values.length>Object.keys(departments).length||values.some((d)=>typeof d!=="string"||!Object.hasOwn(departments,d)))throw Error("Select at least one existing department.");
 const selected=[...new Set(values as string[])];
 if(selected.length!==values.length)throw Error("Remove duplicate department selections.");
 return {name,role:value.role as Assignment,departments:selected};
}
export const idPattern=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
