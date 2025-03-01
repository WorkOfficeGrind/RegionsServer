const mongoose = require("mongoose");

const ZelleSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
    },
  },
  { versionKey: false, timestamps: true }
);

const Zelle = mongoose.model("Zelle", ZelleSchema);

module.exports = Zelle;