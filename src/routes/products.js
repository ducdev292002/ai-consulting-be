import Product from "../models/Product.js";
import { crudRouter } from "./crudFactory.js";

export default crudRouter(Product, { companyScoped: true });
