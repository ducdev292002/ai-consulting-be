import ScriptModel from "../models/Script.js";
import { crudRouter } from "./crudFactory.js";

export default crudRouter(ScriptModel, { companyScoped: true });
