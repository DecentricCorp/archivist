FROM node
ADD ./ ./src/
WORKDIR ./src/
RUN npm install
RUN ls -al node_modules
CMD ["npm" , "run", "serve"]
