import {notFound} from "next/navigation";
import DocsPage from "@/components/docs-page";
import {DOCS} from "@/lib/docs-content";
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;const page=DOCS.find(d=>d.slug===slug);if(!page)notFound();return <DocsPage page={page}/>;}
