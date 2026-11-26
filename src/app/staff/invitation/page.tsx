import type {Metadata} from "next";
import {InvitationForm} from "./invitation-form";
import "../../dashboard/settings/staff-access.css";
export const metadata:Metadata={title:"Staff invitation · EBA Hub",referrer:"no-referrer",robots:{index:false,follow:false}};
export default function StaffInvitation(){return <main className="staff-accept-page"><InvitationForm/></main>}
