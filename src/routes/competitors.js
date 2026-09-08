import CompetitorPrice from "../models/CompetitorPrice.js";
import { crudRouter } from "./crudFactory.js";

export default crudRouter(CompetitorPrice, { companyScoped: true });
