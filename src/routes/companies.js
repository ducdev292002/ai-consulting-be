import Company from "../models/Company.js";
import { crudRouter } from "./crudFactory.js";

export default crudRouter(Company);
