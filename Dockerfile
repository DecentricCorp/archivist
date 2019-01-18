FROM node
WORKDIR ./var/
ADD ./ ./
RUN npm install
CMD ["node", "cli.js"]
