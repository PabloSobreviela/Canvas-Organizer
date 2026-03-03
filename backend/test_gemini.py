import google.generativeai as genai
import os

genai.configure(api_key=os.environ.get("GOOGLE_API_KEY"))

model = genai.GenerativeModel("models/gemini-pro")

response = model.generate_content("Say OK in one word.")

print(response.text)
